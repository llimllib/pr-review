import { execSync } from "node:child_process";
import { setBedrockProviderModule } from "@mariozechner/pi-ai";
import { bedrockProviderModule } from "@mariozechner/pi-ai/bedrock-provider";
import pkg from "../package.json";
import { ALL_AGENT_NAMES } from "./agents.ts";
import {
  fetchPRDiff,
  fetchPRMetadata,
  formatPRContext,
  parseGitHubPR,
} from "./github.ts";
import { listModels } from "./list-models.ts";
import type { ColorMode } from "./output.ts";
import { continueReview, openHtmlReport, runReview } from "./review.ts";

// esbuild can't bundle dynamic imports, so we import the Bedrock provider
// statically and override the module loader
setBedrockProviderModule(bedrockProviderModule);

function usage(exitCode: number = 0): never {
  console.log(`pr-review [options] [git-diff-arguments | github-pr-url]

Ask specialized AI agents to review code changes. Provide either:
  • Git diff arguments (passed to 'git diff')
  • GitHub PR URL (fetched via 'gh' CLI)

Options:
  -a, --agents NAMES     Comma-separated list of agents to run (default: all)
                         Available: ${ALL_AGENT_NAMES.join(", ")}
  -c, --continue MSG     Continue chatting about the last review
  --color WHEN           When to colorize output: auto, always, never (default:
                         auto) Uses mdriver or bat if available.
  --context TEXT         Additional context for the review
  --context -            Read additional context from stdin
  -e, --exclude PATTERN  Exclude files matching pattern (can be repeated)
  --list-models          List available models and exit
  --no-project-context   do not include AGENTS.md/CLAUDE.md from the project
  --html [ID]            Open the HTML report for a session (default: last)
  -m, --model ID         Model to use (see Models section below)
  -q, --quiet            Suppress progress output (spinners, status messages)
  -v, --verbose          Show each sub-agent's output before the summary
  -h, --help             Show this help message
  --version              Show version number

Examples:
  # Git diff syntax
  pr-review main
  pr-review --cached
  pr-review main...feature-branch -- src/
  pr-review --agents bug,test main

  # GitHub PR URLs
  pr-review https://github.com/owner/repo/pull/123
  pr-review https://github.com/owner/repo/pull/123/files
  pr-review owner/repo#123

  # Exclude files
  pr-review --exclude 'package-lock.json' --exclude '*.lock' main
  pr-review --exclude 'transcripts/*' owner/repo#123

  # With options
  pr-review --context "Focus on auth security" main
  pr-review --verbose https://github.com/owner/repo/pull/123

  # Continue chatting about the last review
  pr-review -c "What about edge cases in the auth flow?"
  pr-review -c "Can you show me a code example for fix #2?"

Files:
  ~/.cache/pr-review/                    Session history directory
  ~/.cache/pr-review/last-session.jsonl  Most recent review session

Models:
  The model is selected in this order of priority:
    1. -m/--model flag
    2. PR_REVIEW_MODEL environment variable
    3. claude-sonnet-4-20250514 (if ANTHROPIC_API_KEY is set)
    4. First available model from configured API keys

  Model format: "provider/model-id" or just "model-id"
  Examples: anthropic/claude-sonnet-4-20250514, gpt-4o, bedrock/anthropic.claude-3-sonnet

  Note: This tool does not read pi's default model setting.`);

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
let colorMode: ColorMode = "auto";
let htmlSessionId: string | undefined;
let listModelsFlag = false;
let noProjectContext = false;
const excludePatterns: string[] = [];

const args = process.argv.slice(2);
let i = 0;
while (i < args.length) {
  const arg = args[i]!;
  switch (arg) {
    case "-h":
    case "--help":
      usage(0);
      break;
    case "--version":
      console.log(pkg.version);
      process.exit(0);
      break;
    case "--list-models":
      listModelsFlag = true;
      i++;
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
      agentNames = args[i]!.split(",").map((s) => s.trim());
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
      modelId = args[i]!;
      i++;
      break;
    case "--color":
      i++;
      if (i >= args.length) {
        console.error("Missing value for --color");
        usage(1);
      }
      if (!["auto", "always", "never"].includes(args[i]!)) {
        console.error(
          `Invalid value for --color: ${args[i]}. Must be: auto, always, never`,
        );
        process.exit(1);
      }
      colorMode = args[i]! as ColorMode;
      i++;
      break;
    case "-c":
    case "--continue":
      i++;
      if (i >= args.length) {
        console.error("Missing value for --continue");
        usage(1);
      }
      continueMessage = args[i]!;
      i++;
      break;
    case "--no-project-context":
      noProjectContext = true;
      i++;
      break;
    case "--html":
      i++;
      // Session ID is optional; default to "last"
      if (i < args.length && !args[i]!.startsWith("-")) {
        htmlSessionId = args[i]!;
        i++;
      } else {
        htmlSessionId = "last";
      }
      break;
    case "--context":
      i++;
      if (i >= args.length) {
        console.error("Missing value for --context");
        usage(1);
      }
      if (args[i]! === "-") {
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
        additionalContext += args[i]!;
      }
      i++;
      break;
    case "-e":
    case "--exclude":
      i++;
      if (i >= args.length) {
        console.error("Missing value for --exclude");
        usage(1);
      }
      excludePatterns.push(args[i]!);
      i++;
      break;
    default:
      // Check for --color=* patterns
      if (arg.startsWith("--color=")) {
        const value = arg.slice("--color=".length);
        if (!["auto", "always", "never"].includes(value)) {
          console.error(
            `Invalid value for --color: ${value}. Must be: auto, always, never`,
          );
          process.exit(1);
        }
        colorMode = value as ColorMode;
        i++;
        break;
      }
      // Check for -U flags (unified context)
      if (arg.match(/^-U\d+$/)) {
        hasUnifiedContext = true;
        contextValue = parseInt(arg.slice(2), 10);
        gitArgs.push(arg);
      } else if (arg === "-U") {
        hasUnifiedContext = true;
        i++;
        if (i < args.length && args[i]!.match(/^\d+$/)) {
          contextValue = parseInt(args[i]!, 10);
          gitArgs.push(`-U${args[i]!}`);
        }
      } else if (arg.match(/^--unified=\d+$/)) {
        hasUnifiedContext = true;
        contextValue = parseInt(arg.split("=")[1]!, 10);
        gitArgs.push(arg);
      } else {
        gitArgs.push(arg);
      }
      i++;
      break;
  }
}

const cwd = process.cwd();

// Handle --list-models
if (listModelsFlag) {
  listModels()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(
        `\x1b[31m❌ ${err instanceof Error ? err.message : String(err)}\x1b[0m`,
      );
      process.exit(1);
    });
} else if (htmlSessionId) {
  // Handle HTML report mode
  try {
    openHtmlReport(htmlSessionId);
  } catch (err) {
    console.error(
      `\x1b[31m❌ ${err instanceof Error ? err.message : String(err)}\x1b[0m`,
    );
    process.exit(1);
  }
} else if (continueMessage) {
  // Handle continue mode
  continueReview({
    message: continueMessage,
    cwd,
    modelId,
    quiet,
    colorMode,
    noProjectContext,
  })
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`\x1b[31m❌ ${err.message}\x1b[0m`);
      process.exit(1);
    });
} else {
  // Check if first argument is a GitHub PR URL
  const firstArg = gitArgs[0];
  const prRef = firstArg ? parseGitHubPR(firstArg) : null;

  let diff: string;
  if (prRef) {
    // GitHub PR mode
    if (gitArgs.length > 1) {
      console.error(
        "Cannot mix PR URL with git diff arguments. Use the PR URL alone or git diff syntax.",
      );
      process.exit(1);
    }

    try {
      // Fetch PR metadata for context
      const pr = fetchPRMetadata(prRef);
      const prContext = formatPRContext(pr);

      // Prepend PR context to any additional context
      if (additionalContext) {
        additionalContext = `${prContext}\n\n---\n\n${additionalContext}`;
      } else {
        additionalContext = prContext;
      }

      // Fetch PR diff
      diff = fetchPRDiff(prRef, excludePatterns);

      if (!diff) {
        console.error(`No changes found in PR #${prRef.number}.`);
        process.exit(1);
      }
    } catch (err) {
      console.error(
        `\x1b[31m❌ ${err instanceof Error ? err.message : String(err)}\x1b[0m`,
      );
      process.exit(1);
    }
  } else {
    // Git diff mode
    // Add default unified context if not specified
    if (!hasUnifiedContext) {
      gitArgs.unshift(`-U${contextValue}`);
    }

    // Convert exclude patterns to git pathspecs
    for (const pattern of excludePatterns) {
      gitArgs.push(`':!${pattern}'`);
    }

    // Run git diff
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
    colorMode,
    noProjectContext,
  })
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`\x1b[31m❌ ${err.message}\x1b[0m`);
      process.exit(1);
    });
}
