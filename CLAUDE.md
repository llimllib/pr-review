# CLAUDE.md

This file provides context for AI assistants working on this codebase.

## Project Overview

`pr-review` is a CLI tool that runs multiple specialized AI agents to review git diffs. It's built with TypeScript, bundled with esbuild, and compiled to a standalone binary with Bun.

## Architecture

```
src/
├── cli.ts      # Argument parsing, main entry point
├── agents.ts   # Agent definitions and system prompts
├── review.ts   # Core review logic, session management
└── spinner.ts  # CLI spinner for progress feedback
```

### Key Components

- **Agents** (`agents.ts`): Four specialized reviewers (bug, test, impact, quality) plus a summarizer. Each has a system prompt defining its focus area.

- **Review flow** (`review.ts`):
  1. `runReview()` orchestrates the review process
  2. `runSubAgent()` runs each agent in parallel with read-only file access
  3. `runSummarizer()` synthesizes reports and saves session for continuation
  4. `continueReview()` loads previous session for follow-up questions

- **Session persistence**: Sessions are saved to `~/.cache/pr-review/last-session.jsonl` using pi's `SessionManager`. This enables the `-c/--continue` feature.

## Build System

Two-stage build process:

1. **Bundle** (`build.ts`): Uses esbuild to bundle TypeScript and stub out pi's config loading (we don't need it)
2. **Compile** (`Makefile`): Uses `bun build --compile` to create standalone binary

```bash
bun run build.ts              # Creates build/cli.js
bun build --compile ...       # Creates ./pr-review binary
```

## Dependencies

- `@mariozechner/pi-ai` - Model definitions and types
- `@mariozechner/pi-coding-agent` - Agent sessions, tools, session management

## Key Patterns

### Agent Sessions

```typescript
const { session } = await createAgentSession({
    cwd,
    model,
    resourceLoader: makeResourceLoader(systemPrompt),
    tools: createReadOnlyTools(cwd),  // or [] for summarizer
    sessionManager: SessionManager.inMemory(),  // or persisted
});

session.subscribe((event) => {
    // Handle streaming responses
});

await session.prompt(userMessage);
session.dispose();
```

### Spinner Usage

```typescript
const spinner = createSpinner("Loading...", quiet);
spinner.update("New status...");
spinner.succeed("Done");  // or spinner.fail("Error")
spinner.stop();  // Clear without message
```

## Testing Changes

```bash
# Quick test with one agent
./pr-review -a quality HEAD~1

# Test continuation
./pr-review -c "summarize in one sentence"

# Test quiet mode
./pr-review -q -a bug HEAD~1
```

## Common Tasks

### Adding a new agent

1. Add definition to `AGENTS` in `agents.ts`
2. It will automatically be included in `ALL_AGENT_NAMES`

### Modifying the summarizer prompt

Edit `SUMMARIZER_PROMPT` in `agents.ts`

### Changing session storage location

Modify `SESSION_DIR` and `SESSION_FILE` constants in `review.ts`
