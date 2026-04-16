import { execSync, spawn } from "node:child_process";
import type { Writable } from "node:stream";

export type ColorMode = "auto" | "always" | "never";

const DEBUG = process.env.PR_REVIEW_DEBUG === "1";

function debug(msg: string): void {
  if (DEBUG) {
    process.stderr.write(`[DEBUG output] ${msg}\n`);
  }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function shouldUseColor(colorMode: ColorMode): boolean {
  // --color=never or NO_COLOR env var means no color
  if (colorMode === "never" || process.env.NO_COLOR !== undefined) {
    return false;
  }

  // --color=always forces color
  if (colorMode === "always") {
    return true;
  }

  // auto: only if stdout is a TTY
  return process.stdout.isTTY === true;
}

export interface OutputWriter {
  write(text: string): void;
  end(): Promise<void>;
  endsWithNewline(): boolean;
}

class PlainWriter implements OutputWriter {
  private lastChar = "";

  write(text: string): void {
    process.stdout.write(text);
    if (text.length > 0) {
      this.lastChar = text[text.length - 1]!;
    }
  }

  endsWithNewline(): boolean {
    return this.lastChar === "\n";
  }

  async end(): Promise<void> {
    debug("PlainWriter.end()");
  }
}

class PipedWriter implements OutputWriter {
  private process: ReturnType<typeof spawn>;
  private stdin: Writable;
  private exitPromise: Promise<void>;
  private cmd: string;
  private lastChar = "";

  constructor(cmd: string, args: string[]) {
    this.cmd = cmd;
    debug(`PipedWriter: spawning ${cmd} ${args.join(" ")}`);
    this.process = spawn(cmd, args, {
      stdio: ["pipe", "inherit", "inherit"],
    });
    if (!this.process.stdin) {
      throw new Error(`Failed to open stdin for ${cmd}`);
    }
    this.stdin = this.process.stdin;

    this.exitPromise = new Promise((resolve, reject) => {
      this.process.on("close", (code) => {
        debug(`PipedWriter: ${cmd} closed with code ${code}`);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${cmd} exited with code ${code}`));
        }
      });
      this.process.on("error", (err) => {
        debug(`PipedWriter: ${cmd} error: ${err}`);
        reject(err);
      });
    });
  }

  write(text: string): void {
    this.stdin.write(text);
    if (text.length > 0) {
      this.lastChar = text[text.length - 1]!;
    }
  }

  endsWithNewline(): boolean {
    return this.lastChar === "\n";
  }

  async end(): Promise<void> {
    debug(`PipedWriter.end(): calling stdin.end() for ${this.cmd}`);
    this.stdin.end();
    debug(`PipedWriter.end(): waiting for ${this.cmd} to exit`);
    await this.exitPromise;
    debug(`PipedWriter.end(): ${this.cmd} exited`);
  }
}

export function createOutputWriter(colorMode: ColorMode): OutputWriter {
  debug(`createOutputWriter: colorMode=${colorMode}`);

  if (!shouldUseColor(colorMode)) {
    debug("createOutputWriter: using PlainWriter (no color)");
    return new PlainWriter();
  }

  // Try mdriver first
  if (commandExists("mdriver")) {
    debug("createOutputWriter: using PipedWriter with mdriver");
    return new PipedWriter("mdriver", ["--color", "always"]);
  }

  // Fall back to bat
  if (commandExists("bat")) {
    debug("createOutputWriter: using PipedWriter with bat");
    return new PipedWriter("bat", [
      "--language",
      "markdown",
      "--style",
      "plain",
      "--color",
      "always",
      "--paging",
      "never",
    ]);
  }

  // No formatter available, use plain output
  debug("createOutputWriter: using PlainWriter (no formatter found)");
  return new PlainWriter();
}
