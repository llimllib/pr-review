// Simple CLI spinner for progress feedback

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;

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
		process.stderr.write(`\r\x1b[K\x1b[36m${frame}\x1b[0m ${text}`);
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
