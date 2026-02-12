# pr-review

A CLI tool that uses multiple specialized AI agents to review code changes. Each agent focuses on a different aspect of the review, then a summarizer synthesizes their findings into a single coherent report.

## Installation

### Homebrew (macOS/Linux)

```bash
brew install llimllib/tap/pr-review
```

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
bun build --compile --outfile=pr-review dist/cli.js
```

## Setup

Requires an Anthropic API key:
```bash
export ANTHROPIC_API_KEY=your-key-here
```

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
-a, --agents NAMES  Comma-separated list of agents (default: all)
                    Available: bug, test, impact, quality
-c, --continue MSG  Continue chatting about the last review
--context TEXT      Additional context for the review
--context -         Read context from stdin
-m, --model ID      Model to use (default: claude-sonnet-4-20250514)
-q, --quiet         Suppress progress output
-v, --verbose       Show each agent's raw output
-h, --help          Show help
```

### Agents

- **Bug Hunter** - Finds logic bugs, edge cases, null risks, race conditions
- **Test Reviewer** - Checks test coverage and quality
- **Impact Analyzer** - Traces cross-file dependencies and breaking changes
- **Code Quality** - Reviews style, conventions, error handling

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

## How It Works

1. Runs `git diff` with your arguments
2. Sends the diff to 4 specialized agents in parallel
3. Each agent can read files in your repo for additional context
4. A summarizer synthesizes all reports into a prioritized review
5. Session is saved for follow-up questions with `-c`

## Development

```bash
# Install dependencies
bun install

# Build
bun run build.ts
bun build --compile --outfile=pr-review dist/cli.js

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

## License

MIT
