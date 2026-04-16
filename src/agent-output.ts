// Agent output buffer: collects events from parallel agents and renders them
// to the terminal in a readable way.

/** ANSI color codes for agent names. Cycles through these for each agent. */
const AGENT_COLORS = [
  "\x1b[36m", // cyan
  "\x1b[33m", // yellow
  "\x1b[35m", // magenta
  "\x1b[32m", // green
  "\x1b[34m", // blue
  "\x1b[91m", // bright red
];
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

/** Writable output target. Defaults to process.stderr.write. */
export type WriteFn = (text: string) => void;

const defaultWrite: WriteFn = (text) => process.stderr.write(text);

/** Format a tool call into a short human-readable description. */
export function formatToolAction(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case "read":
      return `read ${args.path ?? ""}`;
    case "grep":
      return `grep ${args.pattern ?? ""}${args.path ? ` ${args.path}` : ""}${args.glob ? ` --glob ${args.glob}` : ""}`;
    case "find":
      return `find ${args.pattern ?? ""}${args.path ? ` in ${args.path}` : ""}`;
    case "ls":
      return `ls ${args.path ?? "."}`;
    case "bash":
      return `bash ${args.command ?? ""}`;
    default:
      return toolName;
  }
}

/** Events that an agent output buffer can receive. */
export type AgentOutputEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_start"; toolName: string; args: Record<string, unknown> }
  | { type: "agent_complete" };

/**
 * Callback for a single agent's output. Created by a renderer via
 * `createCallback(agentName)` — the agent name is already bound.
 */
export type AgentOutputCallback = (event: AgentOutputEvent) => void;

/**
 * Renders output from multiple parallel agents.
 *
 * Two modes:
 * - **verbose**: Prints each line prefixed with a colored agent tag.
 *   Text deltas are line-buffered so output stays readable.
 *   Tool actions get their own line immediately.
 * - **spinner** (default): Updates a spinner with the latest tool action.
 */
export interface AgentRenderer {
  /** Create a callback for a specific agent to pass to runSubAgent. */
  createCallback(agentName: string): AgentOutputCallback;
  /** Flush any remaining buffered text (call after all agents complete). */
  flush(): void;
}

/** Verbose renderer: prints prefixed lines to a writable target. */
export function createVerboseRenderer(
  write: WriteFn = defaultWrite,
): AgentRenderer {
  const colorMap = new Map<string, string>();
  let nextColor = 0;

  // Per-agent line buffer for text deltas
  const lineBuffers = new Map<string, string>();

  function getColor(agentName: string): string {
    let color = colorMap.get(agentName);
    if (!color) {
      color = AGENT_COLORS[nextColor % AGENT_COLORS.length]!;
      nextColor++;
      colorMap.set(agentName, color);
    }
    return color;
  }

  function tag(agentName: string): string {
    const color = getColor(agentName);
    return `${color}[${agentName}]${RESET}`;
  }

  function flushLineBuffer(agentName: string): void {
    const buf = lineBuffers.get(agentName);
    if (buf) {
      write(`${tag(agentName)} ${buf}\n`);
      lineBuffers.set(agentName, "");
    }
  }

  function handleEvent(agentName: string, event: AgentOutputEvent): void {
    switch (event.type) {
      case "text_delta": {
        const existing = lineBuffers.get(agentName) ?? "";
        const combined = existing + event.delta;

        // Split on newlines, flush complete lines
        const lines = combined.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          if (lines[i]!.length > 0) {
            write(`${tag(agentName)} ${lines[i]!}\n`);
          }
        }
        // Keep the last (incomplete) segment in the buffer
        lineBuffers.set(agentName, lines[lines.length - 1]!);
        break;
      }
      case "tool_start": {
        // Flush any pending text first
        flushLineBuffer(agentName);
        const action = formatToolAction(event.toolName, event.args);
        write(`${tag(agentName)} ${DIM}${action}${RESET}\n`);
        break;
      }
      case "agent_complete": {
        flushLineBuffer(agentName);
        break;
      }
    }
  }

  return {
    createCallback(agentName: string): AgentOutputCallback {
      return (event) => handleEvent(agentName, event);
    },
    flush(): void {
      for (const name of lineBuffers.keys()) {
        flushLineBuffer(name);
      }
    },
  };
}

/** Spinner renderer: updates a single spinner line with the latest tool action. */
export function createSpinnerRenderer(
  spinner: { update(text: string): void },
  getCompleted: () => number,
  total: number,
): AgentRenderer {
  const colorMap = new Map<string, string>();
  let nextColor = 0;

  function getColor(agentName: string): string {
    let color = colorMap.get(agentName);
    if (!color) {
      color = AGENT_COLORS[nextColor % AGENT_COLORS.length]!;
      nextColor++;
      colorMap.set(agentName, color);
    }
    return color;
  }

  function handleEvent(agentName: string, event: AgentOutputEvent): void {
    const color = getColor(agentName);
    if (event.type === "tool_start") {
      const action = formatToolAction(event.toolName, event.args);
      spinner.update(
        `${getCompleted()}/${total} complete ${color}[${agentName}]${RESET} ${DIM}${action}${RESET}`,
      );
    } else if (event.type === "agent_complete") {
      // getCompleted() hasn't been incremented yet when this fires,
      // so +1 to show the accurate post-completion count
      const done = getCompleted() + 1;
      spinner.update(
        `${done}/${total} complete ${color}[${agentName}]${RESET} ${DIM}done${RESET}`,
      );
    }
  }

  return {
    createCallback(agentName: string): AgentOutputCallback {
      return (event) => handleEvent(agentName, event);
    },
    flush(): void {
      // Nothing to flush for spinner mode
    },
  };
}
