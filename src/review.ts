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

export interface ReviewOptions {
	diff: string;
	cwd: string;
	agentNames: string[];
	modelId?: string;
	verbose: boolean;
	additionalContext: string;
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
			"No models available. Set ANTHROPIC_API_KEY or configure pi auth.",
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

	return result;
}

async function runSummarizer(
	diff: string,
	reports: Map<string, string>,
	cwd: string,
	model: Model<Api>,
	authStorage: AuthStorage,
	modelRegistry: ModelRegistry,
): Promise<void> {
	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: "off",
		authStorage,
		modelRegistry,
		resourceLoader: makeResourceLoader(SUMMARIZER_PROMPT),
		tools: [],
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 2 },
		}),
	});

	session.subscribe((event) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta"
		) {
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
}

export async function runReview(options: ReviewOptions): Promise<void> {
	const { diff, cwd, agentNames, modelId, verbose, additionalContext } =
		options;

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

		return [agent.name, report] as const;
	});

	const results = await Promise.all(agentPromises);
	const reports = new Map(results);

	if (verbose) {
		process.stderr.write(`\x1b[34m• Running summarizer...\x1b[0m\n\n`);
	}

	// Run summarizer
	await runSummarizer(diff, reports, cwd, model, authStorage, modelRegistry);
	process.stdout.write("\n");
}
