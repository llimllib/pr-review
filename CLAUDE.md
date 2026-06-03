# CLAUDE.md

This file provides context for AI assistants working on this codebase.

## Important Rules

- **Never commit to main and push without explicit permission.** Always create a branch and PR for changes, or ask before pushing to main.
- **Run the lints and tests when you're done writing code** with `make lint test`

## Project Overview

`pr-review` is a CLI tool that runs multiple specialized AI agents to review git diffs. It's built with TypeScript, bundled with esbuild, and compiled to a standalone binary with Bun.

## Commands

```
# build a binary at ./pr-review
make

# run the tests
make test

# run the lints
make lint
```

## Architecture

```
src/
├── agent-output.ts  # Verbose/spinner renderers for streaming agent output
├── agents.ts        # Agent definitions and system prompts
├── cli.ts           # Argument parsing, main entry point
├── context.ts       # Project context file discovery and truncation
├── git-context.ts   # Git diff argument parsing and formatting
├── github.ts        # GitHub PR URL parsing and fetching via gh CLI
├── html.ts          # HTML report generation from ReviewData
├── list-models.ts   # --list-models command implementation
├── markdown.ts      # Markdown report generation from ReviewData
├── output.ts        # Output writer with color/pager support
├── review.ts        # Core review logic, session management
├── spinner.ts       # CLI spinner for progress feedback
└── tools.ts         # Sandboxed read-only tools for sub-agents
```

### Key Components

- **Agents** (`agents.ts`): Four specialized reviewers (bug, test, impact, quality) plus a summarizer. Each has a system prompt defining its focus area.

- **Review flow** (`review.ts`):
  1. `runReview()` orchestrates the review process
  2. `loadProjectContext()` discovers `AGENTS.md`/`CLAUDE.md` once, shared by all agents
  3. `runSubAgent()` runs each agent in parallel with read-only file access
  4. `runSummarizer()` synthesizes reports and saves session for continuation
  5. `continueReview()` loads previous session for follow-up questions

- **Project context** (`context.ts`): Discovers `AGENTS.md`/`CLAUDE.md` from the project directory (and ancestors) using pi's `DefaultResourceLoader`. Files over 8KB are truncated with a warning. Use `--no-project-context` to skip.

- **GitHub PR support** (`github.ts`): Parses GitHub PR URLs (full URLs or `owner/repo#123` format) and fetches PR metadata and diffs using the GitHub CLI (`gh`). PR description is included as additional context for agents. Requires `gh` to be installed and authenticated for private repos.

- **Git context** (`git-context.ts`): Parses git diff arguments to determine what's being compared (branch, commit range, staged changes) and formats it for display.

- **Report generation** (`html.ts`, `markdown.ts`): Generates HTML and Markdown reports from `ReviewData`. Both formats include the summary, individual agent reports, and any follow-up discussions.

- **Output** (`output.ts`): Handles colorized terminal output with optional pager support (bat/mdriver).

- **Agent output** (`agent-output.ts`): Two rendering modes for sub-agent progress — spinner (default) shows tool actions in the spinner text, verbose streams each agent's output with colored labels.

- **Tools** (`tools.ts`): Sandboxed read-only filesystem tools (read, grep, find, ls) that prevent path traversal outside the project directory.

- **Session persistence**: Each review gets a UUIDv7 session ID. Sessions are stored in `~/.cache/pr-review/<session-id>/` with `session.jsonl`, `reports.json`, `review.html`, and `review.md`. A `last` symlink points to the most recent session for `-c/--continue`.

## Key Patterns

### Agent Sessions

```typescript
const contextFiles = await loadProjectContext(cwd, noProjectContext);

const { session } = await createAgentSession({
    cwd,
    model,
    resourceLoader: makeResourceLoader(systemPrompt, contextFiles),
    tools: createReadOnlyTools(cwd),  // or [] for summarizer
    sessionManager: SessionManager.inMemory(),  // or persisted
});

session.subscribe((event) => {
    // Handle streaming responses
});

await session.prompt(userMessage);
session.dispose();
```

## Development Workflow

**Before committing any changes, you MUST run:**

```bash
make lint
```

This runs biome to check code formatting and linting. Fix any issues before committing.

## Common Tasks

### Adding a new agent

1. Add definition to `AGENTS` in `agents.ts`
2. It will automatically be included in `ALL_AGENT_NAMES`

### Modifying the summarizer prompt

Edit `SUMMARIZER_PROMPT` in `agents.ts`

### Changing session storage location

Modify `CACHE_DIR` constant in `review.ts`
