// Simple CLI spinner for progress feedback

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;

// Regex to match ANSI escape sequences (colors, cursor movement, etc.)
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes requires \x1b
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip ANSI escape codes and return the visible character count. */
export function visibleLength(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

/**
 * Truncate text so that its visible length (ignoring ANSI codes) fits within
 * maxVisible characters. ANSI sequences that fall before the cut-off are
 * preserved so colours stay correct; a trailing "…" replaces the last visible
 * character when truncation is needed.
 */
export function truncateToVisible(s: string, maxVisible: number): string {
  if (maxVisible <= 0) return "";
  if (visibleLength(s) <= maxVisible) return s;

  let visible = 0;
  let i = 0;
  // Walk the string, skipping ANSI codes when counting visible chars.
  // We stop one short of maxVisible to leave room for the "…" indicator.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes requires \x1b
  const ansiPattern = /^\x1b\[[0-9;]*m/;
  while (i < s.length && visible < maxVisible - 1) {
    const ansiMatch = s.slice(i).match(ansiPattern);
    if (ansiMatch) {
      i += ansiMatch[0].length;
    } else {
      i++;
      visible++;
    }
  }
  return `${s.slice(0, i)}…\x1b[0m`;
}

export interface Spinner {
  update(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

export function createSpinner(initialText: string, quiet = false): Spinner {
  if (quiet || !process.stderr.isTTY) {
    // No-op spinner for quiet mode or non-TTY
    return {
      update: () => {},
      succeed: () => {},
      fail: () => {},
      stop: () => {},
    };
  }

  let frameIndex = 0;
  let text = initialText;
  let interval: ReturnType<typeof setInterval> | null = null;

  const render = () => {
    const frame = SPINNER_FRAMES[frameIndex];
    // The prefix is "⠋ " (spinner frame + space) = 2 visible columns.
    // Truncate text so the full line never exceeds terminal width,
    // preventing wrap which would leave ghost lines on screen.
    const cols = process.stderr.columns || 80;
    const prefixLen = 2; // frame char + space
    const truncated = truncateToVisible(text, cols - prefixLen);
    process.stderr.write(`\r\x1b[K\x1b[36m${frame}\x1b[0m ${truncated}`);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  };

  // Start spinning
  render();
  interval = setInterval(render, SPINNER_INTERVAL);

  const stop = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    process.stderr.write("\r\x1b[K");
  };

  return {
    update(newText: string) {
      text = newText;
    },
    succeed(finalText?: string) {
      stop();
      process.stderr.write(`\x1b[32m✓\x1b[0m ${finalText ?? text}\n`);
    },
    fail(finalText?: string) {
      stop();
      process.stderr.write(`\x1b[31m✗\x1b[0m ${finalText ?? text}\n`);
    },
    stop,
  };
}
