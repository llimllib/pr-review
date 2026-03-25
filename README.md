# pr-review

A CLI tool based on [pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) that uses multiple specialized AI agents to review code changes. Each agent focuses on a different aspect of the review, then a summarizer synthesizes their findings into a single coherent report.

## Installation

### Homebrew (macOS/Linux)

```bash
brew install llimllib/tap/pr-review
```

You can download a binary from [releases](https://github.com/llimllib/pr-review/releases) if you don't want to use homebrew

## Preview

[![asciicast](https://asciinema.org/a/eTy78CUSTWQe7NZO.svg)](https://asciinema.org/a/eTy78CUSTWQe7NZO)

## The agents

The four sub-agents are:

- [Bug Hunter](https://github.com/llimllib/pr-review/blob/main/src/agents.ts) — Finds logic bugs, edge cases, and incorrect assumptions
- [Test Reviewer](https://github.com/llimllib/pr-review/blob/main/src/agents.ts) — Checks test coverage and quality
- [Impact Analyzer](https://github.com/llimllib/pr-review/blob/main/src/agents.ts) — Traces cross-file dependencies and breaking changes
- [Code Quality](https://github.com/llimllib/pr-review/blob/main/src/agents.ts) — Reviews style, conventions, error handling, and maintainability

Once the agents have reported their results, they're synthesized by the [summarizer](https://github.com/llimllib/pr-review/blob/main/src/agents.ts)

This setup is heavily inspired by [anthropic's pr-review-toolkit](https://github.com/anthropics/claude-code/tree/main/plugins/pr-review-toolkit)

### Download Binary

Download the latest release for your platform from the [releases page](https://github.com/llimllib/pr-review/releases).

```bash
# Example for macOS ARM64
curl -L https://github.com/llimllib/pr-review/releases/latest/download/pr-review-darwin-arm64.tar.gz | tar xz
mv pr-review ~/.local/bin/
```

### Build from Source

Requires [Bun](https://bun.sh):

```bash
git clone https://github.com/llimllib/pr-review
cd pr-review
bun install
bun run build.ts
bun build --compile --outfile=pr-review build/cli.js
```

## Setup

Configure [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#quick-start) if you haven't done so yet

```bash
# Set an environment variable (one of these)
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
export GEMINI_API_KEY=...
export OPENROUTER_API_KEY=...
# ... or any other provider supported by pi

# Or use pi's interactive auth
npm install -g @mariozechner/pi-coding-agent && pi "/login"
```

The default model is `claude-sonnet-4-20250514`. Use `-m` to specify a different model.

## Usage

```bash
# Review changes between HEAD and main
pr-review main

# Review staged changes
pr-review --cached

# Review a specific range
pr-review main...feature-branch

# Review only certain files
pr-review main -- src/

# Exclude files (e.g., lock files)
pr-review main -- ':!package-lock.json'
```

### Options

```
-a, --agents NAMES   Comma-separated list of agents to run (default: all)
                     Available: bug, test, impact, quality
-c, --continue MSG   Continue chatting about the last review
--color WHEN         When to colorize output: auto, always, never (default: auto)
                     Uses mdriver or bat if available. Respects NO_COLOR env var.
--context TEXT       Additional context for the review
--context -          Read additional context from stdin
--list-models        List available models and exit
--no-project-context Skip auto-including AGENTS.md/CLAUDE.md from the project
--html [ID]          Open the HTML report for a session (default: last)
-m, --model ID       Model to use (see Models section below)
-q, --quiet          Suppress progress output (spinners, status messages)
-v, --verbose        Show each sub-agent's output before the summary
-h, --help           Show this help message
--version            Show version number
```

### Models

The model is selected in this order of priority:

1. `-m`/`--model` flag
2. `PR_REVIEW_MODEL` environment variable
3. `claude-sonnet-4-20250514` (if `ANTHROPIC_API_KEY` is set)
4. First available model from configured API keys

Model format: `provider/model-id` or just `model-id`.

Examples: `anthropic/claude-sonnet-4-20250514`, `gpt-4o`, `bedrock/anthropic.claude-3-sonnet`

Use `--list-models` to see all available models for your configured API keys.

> **Note:** This tool does not read pi's default model setting.

### Continuing a Conversation

After a review, you can ask follow-up questions:

```bash
pr-review main
pr-review -c "Can you explain issue #2 in more detail?"
pr-review -c "Show me a code example for the suggested fix"
```

### Providing Context

```bash
# Inline context
pr-review --context "Focus on authentication security" main

# From a file
cat PR_DESCRIPTION.md | pr-review --context - main

# From git commit message
git log -1 --pretty=%B | pr-review --context - main
```

### HTML Reports

Each review generates an HTML report with the full diff, individual agent reports, and the summary. After a review completes, you'll see a hint with the session ID:

```bash
# Open the most recent report
pr-review --html

# Open a specific report by session ID
pr-review --html <session-id>
```

Reports are saved under `~/.cache/pr-review/<session-id>/`.

### Colorized Output

Output is colorized by default when stdout is a TTY. pr-review pipes markdown through [mdriver](https://github.com/badlogic/mdriver) or [bat](https://github.com/sharkdp/bat) if either is available.

```bash
# Force color on (e.g., when piping)
pr-review --color always main | less -R

# Disable color
pr-review --color never main

# Respects NO_COLOR environment variable
NO_COLOR=1 pr-review main
```

## How It Works

1. Runs `git diff` with your arguments
2. Discovers project context files (`AGENTS.md` or `CLAUDE.md`) from your repo
3. Sends the diff to 4 specialized agents in parallel, each with the project context
4. Each agent can read files in your repo for additional context
5. A summarizer synthesizes all reports into a prioritized review
6. Session is saved for follow-up questions with `-c`
7. An HTML report is generated for browsing with `--html`

### Project Context

pr-review automatically discovers and includes `AGENTS.md` or `CLAUDE.md` from your project directory (and parent directories) in the system prompt for all agents. This gives agents awareness of your project's conventions, architecture, and guidelines.

- Files are discovered using the same logic as [pi](https://github.com/badlogic/pi-mono): checks for `AGENTS.md` then `CLAUDE.md` in each directory from the working directory up to the root
- Files larger than 8KB are truncated with a warning
- Use `--no-project-context` to disable this behavior

### Token Usage

After each review, pr-review displays a summary of token usage, cost, cache hit rate, and elapsed time. Use `-q` to suppress this output.

## Files

```
~/.cache/pr-review/                         Session history directory
~/.cache/pr-review/<session-id>/session.jsonl  Session data (for --continue)
~/.cache/pr-review/<session-id>/reports.json   Agent reports and metadata
~/.cache/pr-review/<session-id>/review.html    HTML report (for --html)
~/.cache/pr-review/last                      Symlink to most recent session
```

## Development

```bash
# Install dependencies
bun install

# Build
bun run build.ts
bun build --compile --outfile=pr-review build/cli.js

# Or use make
make pr-review

# Lint
make lint
make lint-fix
```

## Releasing

Releases are automated via GitHub Actions. To create a new release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

This will:
1. Build binaries for Linux and macOS (amd64/arm64)
2. Create a GitHub release with the binaries
3. Update the Homebrew tap formula

## Inspiration

This repository comes from two sources:

- [This skeet from @sunshowers.io](https://bsky.app/profile/did:plc:sl3g3nhnad34sfhjnqdivbzd/post/3membtopelk24)

> my current review prompt:

> ! jj show @- --git
> review this PR systematically and in depth. for the code itself, use the pr-review-toolkit. But also independently think about higher-level architectural concerns and the negative space -- what do we need to update that we missed?

> (using [this plugin](https://github.com/anthropics/claude-code/tree/main/plugins/pr-review-toolkit))

- My [review tool](https://github.com/llimllib/personal_code/blob/master/homedir/.local/bin/review), which I [wrote about here](https://notes.billmill.org/blog/2025/07/An_AI_tool_I_find_useful.html)

## License

MIT
