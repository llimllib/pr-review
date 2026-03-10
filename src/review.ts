import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import { getModel } from "@mariozechner/pi-ai";
import type { ResourceLoader } from "@mariozechner/pi-coding-agent";
import {
	AuthStorage,
	createAgentSession,
	createReadOnlyTools,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { AgentOutputCallback } from "./agent-output.ts";
import {
	createSpinnerRenderer,
	createVerboseRenderer,
} from "./agent-output.ts";
import type { AgentDefinition } from "./agents.ts";
import { AGENTS, SUMMARIZER_PROMPT } from "./agents.ts";
import type { ReviewData } from "./html.ts";
import { generateHtml } from "./html.ts";
import type { ColorMode, OutputWriter } from "./output.ts";
import { createOutputWriter } from "./output.ts";
import { createSpinner, type Spinner } from "./spinner.ts";

const DEBUG = process.env.PR_REVIEW_DEBUG === "1";
const TEST_MODE = process.env.PR_REVIEW_TEST === "1";

function debug(msg: string): void {
	if (DEBUG) {
		process.stderr.write(`[DEBUG review] ${msg}\n`);
	}
}

// Session storage
const CACHE_DIR = path.join(os.homedir(), ".cache", "pr-review");
const LAST_LINK = path.join(CACHE_DIR, "last");

// Legacy session file location (for backward compatibility with --continue)
const LEGACY_SESSION_FILE = path.join(CACHE_DIR, "last-session.jsonl");

function uuidv7(): string {
	// UUIDv7: 48-bit timestamp + 4-bit version + 12-bit rand_a + 2-bit variant + 62-bit rand_b
	const now = Date.now();
	const bytes = crypto.getRandomValues(new Uint8Array(16));

	// Timestamp (48 bits, big-endian) in bytes 0-5
	bytes[0] = (now / 2 ** 40) & 0xff;
	bytes[1] = (now / 2 ** 32) & 0xff;
	bytes[2] = (now / 2 ** 24) & 0xff;
	bytes[3] = (now / 2 ** 16) & 0xff;
	bytes[4] = (now / 2 ** 8) & 0xff;
	bytes[5] = now & 0xff;

	// Version 7 (4 bits)
	bytes[6] = (bytes[6] & 0x0f) | 0x70;
	// Variant 10 (2 bits)
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getSessionDir(sessionId: string): string {
	return path.join(CACHE_DIR, sessionId);
}

function getSessionFile(sessionId: string): string {
	return path.join(getSessionDir(sessionId), "session.jsonl");
}

function getReportsFile(sessionId: string): string {
	return path.join(getSessionDir(sessionId), "reports.json");
}

function getHtmlFile(sessionId: string): string {
	return path.join(getSessionDir(sessionId), "review.html");
}

function updateLastLink(sessionId: string): void {
	try {
		fs.rmSync(LAST_LINK, { force: true });
	} catch {}
	fs.symlinkSync(sessionId, LAST_LINK);
}

/** Resolve a session ID, handling "last" and the symlink. */
export function resolveSessionId(idOrLast: string): string {
	if (idOrLast === "last") {
		if (!fs.existsSync(LAST_LINK)) {
			throw new Error(
				"No previous review session found. Run a review first with: pr-review <git-diff-args>",
			);
		}
		return fs.readlinkSync(LAST_LINK);
	}
	return idOrLast;
}

/** Open the HTML report for a session. */
export function openHtmlReport(sessionId: string): void {
	const resolved = resolveSessionId(sessionId);
	const htmlFile = getHtmlFile(resolved);
	if (!fs.existsSync(htmlFile)) {
		throw new Error(
			`No HTML report found for session ${resolved}. Was this review run with an older version?`,
		);
	}
	execSync(`open ${JSON.stringify(htmlFile)}`, { stdio: "ignore" });
}

export interface ReviewOptions {
	diff: string;
	cwd: string;
	agentNames: string[];
	modelId?: string;
	verbose: boolean;
	quiet: boolean;
	additionalContext: string;
	colorMode: ColorMode;
	noProjectContext: boolean;
}

export interface ContinueOptions {
	message: string;
	cwd: string;
	modelId?: string;
	quiet?: boolean;
	colorMode?: ColorMode;
	noProjectContext?: boolean;
}

// Maximum size (in bytes) of project context files to include.
// Files larger than this are truncated and a warning is emitted.
const MAX_CONTEXT_FILE_BYTES = 8 * 1024; // 8 KB

// Track files we've already warned about to avoid duplicate warnings
const truncationWarned = new Set<string>();

async function makeResourceLoader(
	systemPrompt: string,
	cwd: string,
	noProjectContext: boolean,
): Promise<ResourceLoader> {
	const loader = new DefaultResourceLoader({
		cwd,
		systemPrompt,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		...(noProjectContext
			? { agentsFilesOverride: () => ({ agentsFiles: [] }) }
			: {
					agentsFilesOverride: (base) => ({
						agentsFiles: base.agentsFiles.map(({ path: filePath, content }) => {
							if (content.length > MAX_CONTEXT_FILE_BYTES) {
								if (!truncationWarned.has(filePath)) {
									truncationWarned.add(filePath);
									process.stderr.write(
										`\x1b[33m! Project context file ${filePath} is ${(content.length / 1024).toFixed(1)}KB, truncating to ${MAX_CONTEXT_FILE_BYTES / 1024}KB. Use --no-project-context to skip.\x1b[0m\n`,
									);
								}
								return {
									path: filePath,
									content: `${content.slice(0, MAX_CONTEXT_FILE_BYTES)}\n\n[... truncated, file was ${(content.length / 1024).toFixed(1)}KB ...]`,
								};
							}
							return { path: filePath, content };
						}),
					}),
				}),
	});
	await loader.reload();
	return loader;
}

async function resolveModel(
	authStorage: AuthStorage,
	modelRegistry: ModelRegistry,
	modelId?: string,
) {
	// Check environment variable if no explicit model provided
	const effectiveModelId = modelId ?? process.env.PR_REVIEW_MODEL;

	if (effectiveModelId) {
		// Try to find by id across all providers
		const available = await modelRegistry.getAvailable();
		for (const m of available) {
			if (
				m.id === effectiveModelId ||
				`${m.provider}/${m.id}` === effectiveModelId
			) {
				return m;
			}
		}
		throw new Error(
			`Model "${effectiveModelId}" not found or no API key available`,
		);
	}

	// Default: try sonnet first, then whatever is available
	const sonnet = getModel("anthropic", "claude-sonnet-4-20250514");
	if (sonnet) {
		const key = await authStorage.getApiKey("anthropic");
		if (key) return sonnet;
	}

	const available = await modelRegistry.getAvailable();
	if (available.length === 0) {
		throw new Error(
			"No API key configured. Either:\n" +
				"  • Set ANTHROPIC_API_KEY (or OPENAI_API_KEY, etc.) environment variable\n" +
				"  • Run 'pi auth' to configure authentication interactively",
		);
	}
	return available[0];
}

async function runSubAgent(
	agent: AgentDefinition,
	diff: string,
	cwd: string,
	model: Model<Api>,
	authStorage: AuthStorage,
	modelRegistry: ModelRegistry,
	additionalContext: string,
	noProjectContext: boolean,
	onOutput?: AgentOutputCallback,
): Promise<string> {
	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: "off",
		authStorage,
		modelRegistry,
		resourceLoader: await makeResourceLoader(
			agent.systemPrompt,
			cwd,
			noProjectContext,
		),
		tools: createReadOnlyTools(cwd),
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 2 },
		}),
	});

	let result = "";
	const unsubscribe = session.subscribe((event) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta"
		) {
			result += event.assistantMessageEvent.delta;
			onOutput?.({
				type: "text_delta",
				delta: event.assistantMessageEvent.delta,
			});
		} else if (event.type === "tool_execution_start") {
			onOutput?.({
				type: "tool_start",
				toolName: event.toolName,
				args: event.args,
			});
		}
	});

	let prompt = `Here is the git diff to review:\n\n\`\`\`diff\n${diff}\n\`\`\``;
	if (additionalContext) {
		prompt += `\n\nAdditional context from the reviewer:\n${additionalContext}`;
	}

	await session.prompt(prompt);
	onOutput?.({ type: "agent_complete" });
	unsubscribe();
	session.dispose();

	return result;
}

async function runSummarizer(
	diff: string,
	reports: Map<string, string>,
	cwd: string,
	model: Model<Api>,
	authStorage: AuthStorage,
	modelRegistry: ModelRegistry,
	outputWriter: OutputWriter,
	sessionId: string,
	noProjectContext: boolean,
	spinner?: Spinner,
): Promise<string> {
	const sessionDir = getSessionDir(sessionId);
	// Ensure session directory exists
	fs.mkdirSync(sessionDir, { recursive: true });

	// Create a persistent session for the summarizer
	const sessionManager = SessionManager.create(cwd, sessionDir);
	// Rename the session file to our known location for easy continuation
	const originalFile = sessionManager.getSessionFile();

	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: "off",
		authStorage,
		modelRegistry,
		resourceLoader: await makeResourceLoader(
			SUMMARIZER_PROMPT,
			cwd,
			noProjectContext,
		),
		tools: [],
		sessionManager,
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 2 },
		}),
	});

	let firstChunk = true;
	let summaryText = "";
	const unsubscribe = session.subscribe((event) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta"
		) {
			if (firstChunk) {
				spinner?.stop();
				firstChunk = false;
			}
			summaryText += event.assistantMessageEvent.delta;
			outputWriter.write(event.assistantMessageEvent.delta);
		}
	});

	let prompt = `Here is the git diff:\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;
	prompt += `Here are the individual review reports:\n\n`;
	for (const [name, report] of reports) {
		prompt += `## ${name}\n\n${report}\n\n---\n\n`;
	}

	debug("runSummarizer: calling session.prompt()");
	await session.prompt(prompt);
	debug("runSummarizer: session.prompt() complete");
	unsubscribe();
	debug("runSummarizer: unsubscribed");
	session.dispose();
	debug("runSummarizer: session disposed");

	// Copy the session file to our known location for easy continuation
	const sessionFile = getSessionFile(sessionId);
	if (originalFile && fs.existsSync(originalFile)) {
		fs.copyFileSync(originalFile, sessionFile);
		// Also copy to legacy location for backward compatibility
		fs.copyFileSync(originalFile, LEGACY_SESSION_FILE);
	}
	debug("runSummarizer: complete");
	return summaryText;
}

export async function continueReview(options: ContinueOptions): Promise<void> {
	const {
		message,
		cwd,
		modelId,
		quiet = false,
		colorMode = "auto",
		noProjectContext = false,
	} = options;

	// Check if we have a previous session — try new location first, then legacy
	let sessionFile: string;
	let sessionDir: string;
	if (fs.existsSync(LAST_LINK)) {
		const lastId = fs.readlinkSync(LAST_LINK);
		sessionDir = getSessionDir(lastId);
		sessionFile = getSessionFile(lastId);
	} else if (fs.existsSync(LEGACY_SESSION_FILE)) {
		sessionDir = CACHE_DIR;
		sessionFile = LEGACY_SESSION_FILE;
	} else {
		throw new Error(
			"No previous review session found. Run a review first with: pr-review <git-diff-args>",
		);
	}

	if (!fs.existsSync(sessionFile)) {
		throw new Error(
			"No previous review session found. Run a review first with: pr-review <git-diff-args>",
		);
	}

	const spinner = createSpinner("Loading previous session...", quiet);

	const authStorage = new AuthStorage();
	const modelRegistry = new ModelRegistry(authStorage);
	const model = await resolveModel(authStorage, modelRegistry, modelId);

	// Open the existing session
	const sessionManager = SessionManager.open(sessionFile, sessionDir);

	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: "off",
		authStorage,
		modelRegistry,
		resourceLoader: await makeResourceLoader(
			SUMMARIZER_PROMPT,
			cwd,
			noProjectContext,
		),
		tools: [],
		sessionManager,
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 2 },
		}),
	});

	spinner.succeed("Session loaded");

	const outputWriter = createOutputWriter(colorMode);

	const unsubscribe = session.subscribe((event) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta"
		) {
			outputWriter.write(event.assistantMessageEvent.delta);
		}
	});

	await session.prompt(message);
	unsubscribe();
	session.dispose();
	await outputWriter.end();
	if (!outputWriter.endsWithNewline()) {
		process.stdout.write("\n");
	}
}

export async function runReview(options: ReviewOptions): Promise<void> {
	const {
		diff,
		cwd,
		agentNames,
		modelId,
		verbose,
		quiet,
		additionalContext,
		colorMode,
		noProjectContext,
	} = options;

	// Test mode: output mock content without calling LLM
	if (TEST_MODE) {
		debug("TEST_MODE: skipping LLM calls");
		const outputWriter = createOutputWriter(colorMode);

		const mockOutput = `# Code Review Summary

## Critical Issues
- **Bug Found**: Mock issue 1 in the diff
- **Security**: Mock security concern

## Test Coverage
- Missing tests for edge cases

## Code Quality
- Good structure overall
- Consider extracting helper functions

\`\`\`typescript
// Example suggestion
function helper() {
  return "extracted";
}
\`\`\`

## Recommendations
1. Add unit tests
2. Fix the bug
3. Review security implications
`;

		// Simulate streaming by writing line by line
		const lines = mockOutput.split("\n");
		for (let i = 0; i < lines.length; i++) {
			outputWriter.write(lines[i]);
			if (i < lines.length - 1) {
				outputWriter.write("\n");
			}
			await new Promise((r) => setTimeout(r, 5));
		}

		debug("TEST_MODE: calling outputWriter.end()");
		await outputWriter.end();
		debug("TEST_MODE: outputWriter.end() complete");
		if (!outputWriter.endsWithNewline()) {
			process.stdout.write("\n");
		}
		debug("TEST_MODE: complete");
		return;
	}

	const spinner = createSpinner("Initializing...", quiet || verbose);

	const authStorage = new AuthStorage();
	const modelRegistry = new ModelRegistry(authStorage);
	const model = await resolveModel(authStorage, modelRegistry, modelId);

	if (verbose) {
		process.stderr.write(
			`\x1b[34m• Using model: ${model.provider}/${model.id}\x1b[0m\n`,
		);
		process.stderr.write(
			`\x1b[34m• Running agents: ${agentNames.join(", ")}\x1b[0m\n\n`,
		);
	}

	// Track completed agents
	const completed: string[] = [];
	const total = agentNames.length;

	// Create the appropriate renderer for agent output
	const renderer = verbose
		? createVerboseRenderer()
		: createSpinnerRenderer(spinner, () => completed.length, total);

	spinner.update(`Running agents... (0/${total})`);

	// Run sub-agents in parallel
	const agentPromises = agentNames.map(async (name) => {
		const agent = AGENTS[name];
		if (!agent) throw new Error(`Unknown agent: ${name}`);

		const onOutput = renderer.createCallback(agent.name);

		const report = await runSubAgent(
			agent,
			diff,
			cwd,
			model,
			authStorage,
			modelRegistry,
			additionalContext,
			noProjectContext,
			onOutput,
		);

		completed.push(name);

		return [agent.name, report] as const;
	});

	const results = await Promise.all(agentPromises);
	renderer.flush();
	const reports = new Map(results);

	spinner.succeed(`Agents complete (${total}/${total})`);

	if (verbose) {
		process.stderr.write(`\x1b[34m• Running summarizer...\x1b[0m\n\n`);
	}

	const summarizerSpinner = createSpinner(
		"Generating summary...",
		quiet || verbose,
	);

	const outputWriter = createOutputWriter(colorMode);

	// Generate a session ID for this review
	const sessionId = uuidv7();
	const modelLabel = `${model.provider}/${model.id}`;

	// Run summarizer
	const summaryText = await runSummarizer(
		diff,
		reports,
		cwd,
		model,
		authStorage,
		modelRegistry,
		outputWriter,
		sessionId,
		noProjectContext,
		summarizerSpinner,
	);
	debug("runReview: runSummarizer complete, calling outputWriter.end()");
	await outputWriter.end();
	debug("runReview: outputWriter.end() complete");

	// Ensure summary output ends with exactly one newline before the hint
	if (!outputWriter.endsWithNewline()) {
		process.stdout.write("\n");
	}

	// Save reports and generate HTML
	const reviewData: ReviewData = {
		id: sessionId,
		timestamp: new Date().toISOString(),
		model: modelLabel,
		agents: Array.from(reports.keys()),
		diff,
		reports: Object.fromEntries(reports),
		summary: summaryText,
	};

	const sessionDir = getSessionDir(sessionId);
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(getReportsFile(sessionId), JSON.stringify(reviewData));
	fs.writeFileSync(getHtmlFile(sessionId), generateHtml(reviewData));
	updateLastLink(sessionId);

	// Print hint about HTML report
	process.stderr.write(
		`\x1b[34mView full report: pr-review --html ${sessionId}\x1b[0m\n`,
	);

	debug("runReview: complete");
}
