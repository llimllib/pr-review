import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import { getModel } from "@mariozechner/pi-ai";
import type { ResourceLoader } from "@mariozechner/pi-coding-agent";
import {
	AuthStorage,
	createAgentSession,
	createExtensionRuntime,
	createReadOnlyTools,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { AgentDefinition } from "./agents.ts";
import { AGENTS, SUMMARIZER_PROMPT } from "./agents.ts";
import { createSpinner, type Spinner } from "./spinner.ts";

// Session file for continuing conversations
const SESSION_DIR = path.join(os.homedir(), ".cache", "pr-review");
const SESSION_FILE = path.join(SESSION_DIR, "last-session.jsonl");

export interface ReviewOptions {
	diff: string;
	cwd: string;
	agentNames: string[];
	modelId?: string;
	verbose: boolean;
	quiet: boolean;
	additionalContext: string;
}

export interface ContinueOptions {
	message: string;
	cwd: string;
	modelId?: string;
	quiet?: boolean;
}

function makeResourceLoader(systemPrompt: string): ResourceLoader {
	return {
		getExtensions: () => ({
			extensions: [],
			errors: [],
			runtime: createExtensionRuntime(),
		}),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => [],
		getPathMetadata: () => new Map(),
		extendResources: () => {},
		reload: async () => {},
	};
}

async function resolveModel(
	authStorage: AuthStorage,
	modelRegistry: ModelRegistry,
	modelId?: string,
) {
	if (modelId) {
		// Try to find by id across all providers
		const available = await modelRegistry.getAvailable();
		for (const m of available) {
			if (m.id === modelId || `${m.provider}/${m.id}` === modelId) {
				return m;
			}
		}
		throw new Error(`Model "${modelId}" not found or no API key available`);
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
	verbose: boolean,
	spinner?: Spinner,
): Promise<string> {
	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: "off",
		authStorage,
		modelRegistry,
		resourceLoader: makeResourceLoader(agent.systemPrompt),
		tools: createReadOnlyTools(cwd),
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 2 },
		}),
	});

	let result = "";
	session.subscribe((event) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta"
		) {
			result += event.assistantMessageEvent.delta;
			if (verbose) {
				process.stderr.write(event.assistantMessageEvent.delta);
			}
		}
	});

	let prompt = `Here is the git diff to review:\n\n\`\`\`diff\n${diff}\n\`\`\``;
	if (additionalContext) {
		prompt += `\n\nAdditional context from the reviewer:\n${additionalContext}`;
	}

	await session.prompt(prompt);
	session.dispose();

	spinner?.succeed(agent.name);
	return result;
}

async function runSummarizer(
	diff: string,
	reports: Map<string, string>,
	cwd: string,
	model: Model<Api>,
	authStorage: AuthStorage,
	modelRegistry: ModelRegistry,
	spinner?: Spinner,
): Promise<void> {
	// Ensure session directory exists
	fs.mkdirSync(SESSION_DIR, { recursive: true });

	// Create a persistent session for the summarizer
	const sessionManager = SessionManager.create(cwd, SESSION_DIR);
	// Rename the session file to our known location for easy continuation
	const originalFile = sessionManager.getSessionFile();

	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: "off",
		authStorage,
		modelRegistry,
		resourceLoader: makeResourceLoader(SUMMARIZER_PROMPT),
		tools: [],
		sessionManager,
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 2 },
		}),
	});

	let firstChunk = true;
	session.subscribe((event) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta"
		) {
			if (firstChunk) {
				spinner?.stop();
				firstChunk = false;
			}
			process.stdout.write(event.assistantMessageEvent.delta);
		}
	});

	let prompt = `Here is the git diff:\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;
	prompt += `Here are the individual review reports:\n\n`;
	for (const [name, report] of reports) {
		prompt += `## ${name}\n\n${report}\n\n---\n\n`;
	}

	await session.prompt(prompt);
	session.dispose();

	// Copy the session file to our known location
	if (originalFile && fs.existsSync(originalFile)) {
		fs.copyFileSync(originalFile, SESSION_FILE);
	}
}

export async function continueReview(options: ContinueOptions): Promise<void> {
	const { message, cwd, modelId, quiet = false } = options;

	// Check if we have a previous session
	if (!fs.existsSync(SESSION_FILE)) {
		throw new Error(
			"No previous review session found. Run a review first with: pr-review <git-diff-args>",
		);
	}

	const spinner = createSpinner("Loading previous session...", quiet);

	const authStorage = new AuthStorage();
	const modelRegistry = new ModelRegistry(authStorage);
	const model = await resolveModel(authStorage, modelRegistry, modelId);

	// Open the existing session
	const sessionManager = SessionManager.open(SESSION_FILE, SESSION_DIR);

	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: "off",
		authStorage,
		modelRegistry,
		resourceLoader: makeResourceLoader(SUMMARIZER_PROMPT),
		tools: [],
		sessionManager,
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 2 },
		}),
	});

	spinner.succeed("Session loaded");

	session.subscribe((event) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta"
		) {
			process.stdout.write(event.assistantMessageEvent.delta);
		}
	});

	await session.prompt(message);
	session.dispose();
	process.stdout.write("\n");
}

export async function runReview(options: ReviewOptions): Promise<void> {
	const { diff, cwd, agentNames, modelId, verbose, quiet, additionalContext } =
		options;

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

	// Track completed agents for spinner updates
	const completed: string[] = [];
	const total = agentNames.length;

	const updateSpinner = () => {
		const remaining = agentNames.filter((n) => !completed.includes(n));
		if (remaining.length > 0) {
			const agent = AGENTS[remaining[0]];
			spinner.update(
				`Running ${agent?.name ?? remaining[0]}... (${completed.length}/${total})`,
			);
		}
	};

	spinner.update(`Running agents... (0/${total})`);

	// Run sub-agents in parallel
	const agentPromises = agentNames.map(async (name) => {
		const agent = AGENTS[name];
		if (!agent) throw new Error(`Unknown agent: ${name}`);

		if (verbose) {
			process.stderr.write(`\x1b[33m━━━ ${agent.name} ━━━\x1b[0m\n`);
		}

		const report = await runSubAgent(
			agent,
			diff,
			cwd,
			model,
			authStorage,
			modelRegistry,
			additionalContext,
			verbose,
		);

		if (verbose) {
			process.stderr.write(`\n\x1b[33m━━━ end ${agent.name} ━━━\x1b[0m\n\n`);
		}

		completed.push(name);
		updateSpinner();

		return [agent.name, report] as const;
	});

	const results = await Promise.all(agentPromises);
	const reports = new Map(results);

	spinner.succeed(`Agents complete (${total}/${total})`);

	if (verbose) {
		process.stderr.write(`\x1b[34m• Running summarizer...\x1b[0m\n\n`);
	}

	const summarizerSpinner = createSpinner(
		"Generating summary...",
		quiet || verbose,
	);

	// Run summarizer
	await runSummarizer(
		diff,
		reports,
		cwd,
		model,
		authStorage,
		modelRegistry,
		summarizerSpinner,
	);
	process.stdout.write("\n");
}
