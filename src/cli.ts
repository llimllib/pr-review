import { execSync } from "node:child_process";
import { ALL_AGENT_NAMES } from "./agents.ts";
import { continueReview, runReview } from "./review.ts";

function usage(exitCode: number = 0): never {
	console.log(`pr-review [options] [git-diff-arguments...]

Ask specialized AI agents to review code changes. Arguments are passed
directly to 'git diff', so any git diff syntax works.

Options:
  -a, --agents NAMES  Comma-separated list of agents to run (default: all)
                      Available: ${ALL_AGENT_NAMES.join(", ")}
  -c, --continue MSG  Continue chatting about the last review
  --context TEXT      Additional context for the review
  --context -         Read additional context from stdin
  -m, --model ID      Model to use (default: claude-sonnet-4-20250514)
  -q, --quiet         Suppress progress output (spinners, status messages)
  -v, --verbose       Show each sub-agent's output before the summary
  -h, --help          Show this help message

Examples:
  pr-review main
  pr-review --cached
  pr-review main...feature-branch -- src/
  pr-review --agents bug,test main
  pr-review --context "Focus on auth security" main
  pr-review --verbose main
  
  # Continue chatting about the last review
  pr-review -c "What about edge cases in the auth flow?"
  pr-review -c "Can you show me a code example for fix #2?"`);
	process.exit(exitCode);
}

// Parse args
const gitArgs: string[] = [];
let agentNames = ALL_AGENT_NAMES;
let modelId: string | undefined;
let verbose = false;
let quiet = false;
let additionalContext = "";
let contextValue = 10;
let hasUnifiedContext = false;
let continueMessage: string | undefined;

const args = process.argv.slice(2);
let i = 0;
while (i < args.length) {
	const arg = args[i];
	switch (arg) {
		case "-h":
		case "--help":
			usage(0);
			break;
		case "-v":
		case "--verbose":
			verbose = true;
			i++;
			break;
		case "-q":
		case "--quiet":
			quiet = true;
			i++;
			break;
		case "-a":
		case "--agents":
			i++;
			if (i >= args.length) {
				console.error("Missing value for --agents");
				usage(1);
			}
			agentNames = args[i].split(",").map((s) => s.trim());
			for (const name of agentNames) {
				if (!ALL_AGENT_NAMES.includes(name)) {
					console.error(
						`Unknown agent: ${name}. Available: ${ALL_AGENT_NAMES.join(", ")}`,
					);
					process.exit(1);
				}
			}
			i++;
			break;
		case "-m":
		case "--model":
			i++;
			if (i >= args.length) {
				console.error("Missing value for --model");
				usage(1);
			}
			modelId = args[i];
			i++;
			break;
		case "-c":
		case "--continue":
			i++;
			if (i >= args.length) {
				console.error("Missing value for --continue");
				usage(1);
			}
			continueMessage = args[i];
			i++;
			break;
		case "--context":
			i++;
			if (i >= args.length) {
				console.error("Missing value for --context");
				usage(1);
			}
			if (args[i] === "-") {
				// Read from stdin
				try {
					additionalContext += execSync("cat", {
						stdio: ["inherit", "pipe", "pipe"],
					}).toString();
				} catch {
					console.error("Failed to read from stdin");
					process.exit(1);
				}
			} else {
				if (additionalContext) additionalContext += "\n\n";
				additionalContext += args[i];
			}
			i++;
			break;
		default:
			// Check for -U flags (unified context)
			if (arg.match(/^-U\d+$/)) {
				hasUnifiedContext = true;
				contextValue = parseInt(arg.slice(2), 10);
				gitArgs.push(arg);
			} else if (arg === "-U") {
				hasUnifiedContext = true;
				i++;
				if (i < args.length && args[i].match(/^\d+$/)) {
					contextValue = parseInt(args[i], 10);
					gitArgs.push(`-U${args[i]}`);
				}
			} else if (arg.match(/^--unified=\d+$/)) {
				hasUnifiedContext = true;
				contextValue = parseInt(arg.split("=")[1], 10);
				gitArgs.push(arg);
			} else {
				gitArgs.push(arg);
			}
			i++;
			break;
	}
}

const cwd = process.cwd();

// Handle continue mode
if (continueMessage) {
	continueReview({ message: continueMessage, cwd, modelId, quiet }).catch(
		(err) => {
			console.error(`\x1b[31m❌ ${err.message}\x1b[0m`);
			process.exit(1);
		},
	);
} else {
	// Add default unified context if not specified
	if (!hasUnifiedContext) {
		gitArgs.unshift(`-U${contextValue}`);
	}

	// Run git diff
	let diff: string;
	try {
		diff = execSync(`git diff ${gitArgs.map((a) => `'${a}'`).join(" ")}`, {
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
		}).trim();
	} catch (err) {
		console.error(
			`git diff failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	}

	if (!diff) {
		console.error("No changes found to review.");
		process.exit(1);
	}

	// Estimate tokens and warn if large
	const estimatedTokens = Math.ceil(diff.length / 4);
	if (estimatedTokens > 50000) {
		process.stderr.write(
			`\x1b[33m! Large diff (~${Math.round(estimatedTokens / 1000)}k tokens). Consider reviewing a smaller set of changes.\x1b[0m\n`,
		);
	}

	runReview({
		diff,
		cwd,
		agentNames,
		modelId,
		verbose,
		quiet,
		additionalContext,
	}).catch((err) => {
		console.error(`\x1b[31m❌ ${err.message}\x1b[0m`);
		process.exit(1);
	});
}
