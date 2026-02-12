import { spawn, execSync } from "node:child_process";
import type { Writable } from "node:stream";

export type ColorMode = "auto" | "always" | "never";

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
}

class PlainWriter implements OutputWriter {
	write(text: string): void {
		process.stdout.write(text);
	}

	async end(): Promise<void> {
		// Nothing to do
	}
}

class PipedWriter implements OutputWriter {
	private process: ReturnType<typeof spawn>;
	private stdin: Writable;
	private exitPromise: Promise<void>;

	constructor(cmd: string, args: string[]) {
		this.process = spawn(cmd, args, {
			stdio: ["pipe", "inherit", "inherit"],
		});
		this.stdin = this.process.stdin;

		this.exitPromise = new Promise((resolve, reject) => {
			this.process.on("close", (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`${cmd} exited with code ${code}`));
				}
			});
			this.process.on("error", reject);
		});
	}

	write(text: string): void {
		this.stdin.write(text);
	}

	async end(): Promise<void> {
		this.stdin.end();
		await this.exitPromise;
	}
}

export function createOutputWriter(colorMode: ColorMode): OutputWriter {
	if (!shouldUseColor(colorMode)) {
		return new PlainWriter();
	}

	// Try mdriver first
	if (commandExists("mdriver")) {
		return new PipedWriter("mdriver", ["--color", "always"]);
	}

	// Fall back to bat
	if (commandExists("bat")) {
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
	return new PlainWriter();
}
