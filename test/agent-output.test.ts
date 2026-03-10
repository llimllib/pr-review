import { describe, expect, test } from "bun:test";
import {
	createSpinnerRenderer,
	createVerboseRenderer,
	formatToolAction,
} from "../src/agent-output.ts";

// Strip ANSI escape codes for easier assertions
function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// Collect output lines from a WriteFn
function captureOutput(): { lines: string[]; write: (text: string) => void } {
	const lines: string[] = [];
	return {
		lines,
		write: (text: string) => lines.push(text),
	};
}

// ── formatToolAction ────────────────────────────────────────────────

describe("formatToolAction", () => {
	test("read with path", () => {
		expect(formatToolAction("read", { path: "src/cli.ts" })).toBe(
			"read src/cli.ts",
		);
	});

	test("read with no path", () => {
		expect(formatToolAction("read", {})).toBe("read ");
	});

	test("grep with pattern only", () => {
		expect(formatToolAction("grep", { pattern: "TODO" })).toBe("grep TODO");
	});

	test("grep with pattern and path", () => {
		expect(
			formatToolAction("grep", { pattern: "TODO", path: "src/" }),
		).toBe("grep TODO src/");
	});

	test("grep with pattern and glob", () => {
		expect(
			formatToolAction("grep", { pattern: "TODO", glob: "*.ts" }),
		).toBe("grep TODO --glob *.ts");
	});

	test("grep with pattern, path, and glob", () => {
		expect(
			formatToolAction("grep", {
				pattern: "TODO",
				path: "src/",
				glob: "*.ts",
			}),
		).toBe("grep TODO src/ --glob *.ts");
	});

	test("find with pattern", () => {
		expect(formatToolAction("find", { pattern: "*.test.ts" })).toBe(
			"find *.test.ts",
		);
	});

	test("find with pattern and path", () => {
		expect(
			formatToolAction("find", { pattern: "*.test.ts", path: "src/" }),
		).toBe("find *.test.ts in src/");
	});

	test("ls with path", () => {
		expect(formatToolAction("ls", { path: "src/" })).toBe("ls src/");
	});

	test("ls with no path", () => {
		expect(formatToolAction("ls", {})).toBe("ls .");
	});

	test("bash with command", () => {
		expect(
			formatToolAction("bash", { command: "git log --oneline" }),
		).toBe("bash git log --oneline");
	});

	test("unknown tool", () => {
		expect(formatToolAction("custom_tool", { foo: "bar" })).toBe(
			"custom_tool",
		);
	});
});

// ── Verbose Renderer ────────────────────────────────────────────────

describe("createVerboseRenderer", () => {
	test("text_delta with complete line is flushed", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const cb = renderer.createCallback("Bug Hunter");

		cb({ type: "text_delta", delta: "Hello world\n" });

		expect(lines.length).toBe(1);
		expect(stripAnsi(lines[0])).toBe("[Bug Hunter] Hello world\n");
	});

	test("text_delta buffers incomplete lines until newline", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const cb = renderer.createCallback("Bug Hunter");

		cb({ type: "text_delta", delta: "Hello " });
		expect(lines.length).toBe(0);

		cb({ type: "text_delta", delta: "world\n" });
		expect(lines.length).toBe(1);
		expect(stripAnsi(lines[0])).toBe("[Bug Hunter] Hello world\n");
	});

	test("text_delta with multiple lines in one delta", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const cb = renderer.createCallback("Bug Hunter");

		cb({ type: "text_delta", delta: "line 1\nline 2\nline 3\n" });

		expect(lines.length).toBe(3);
		expect(stripAnsi(lines[0])).toBe("[Bug Hunter] line 1\n");
		expect(stripAnsi(lines[1])).toBe("[Bug Hunter] line 2\n");
		expect(stripAnsi(lines[2])).toBe("[Bug Hunter] line 3\n");
	});

	test("text_delta with trailing incomplete segment", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const cb = renderer.createCallback("Bug Hunter");

		cb({ type: "text_delta", delta: "line 1\npartial" });
		expect(lines.length).toBe(1);
		expect(stripAnsi(lines[0])).toBe("[Bug Hunter] line 1\n");

		// "partial" stays buffered until next newline
		cb({ type: "text_delta", delta: " end\n" });
		expect(lines.length).toBe(2);
		expect(stripAnsi(lines[1])).toBe("[Bug Hunter] partial end\n");
	});

	test("empty lines in text_delta are skipped", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const cb = renderer.createCallback("Bug Hunter");

		cb({ type: "text_delta", delta: "line 1\n\nline 3\n" });

		// Empty line between line 1 and line 3 should be skipped
		expect(lines.length).toBe(2);
		expect(stripAnsi(lines[0])).toBe("[Bug Hunter] line 1\n");
		expect(stripAnsi(lines[1])).toBe("[Bug Hunter] line 3\n");
	});

	test("tool_start flushes pending text then prints action", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const cb = renderer.createCallback("Bug Hunter");

		cb({ type: "text_delta", delta: "thinking..." });
		expect(lines.length).toBe(0);

		cb({
			type: "tool_start",
			toolName: "read",
			args: { path: "src/cli.ts" },
		});

		// Should flush the buffered text, then print the tool action
		expect(lines.length).toBe(2);
		expect(stripAnsi(lines[0])).toBe("[Bug Hunter] thinking...\n");
		expect(stripAnsi(lines[1])).toBe("[Bug Hunter] read src/cli.ts\n");
	});

	test("tool_start with no pending text", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const cb = renderer.createCallback("Bug Hunter");

		cb({
			type: "tool_start",
			toolName: "grep",
			args: { pattern: "TODO" },
		});

		expect(lines.length).toBe(1);
		expect(stripAnsi(lines[0])).toBe("[Bug Hunter] grep TODO\n");
	});

	test("agent_complete flushes remaining buffer", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const cb = renderer.createCallback("Bug Hunter");

		cb({ type: "text_delta", delta: "final thought" });
		expect(lines.length).toBe(0);

		cb({ type: "agent_complete" });
		expect(lines.length).toBe(1);
		expect(stripAnsi(lines[0])).toBe("[Bug Hunter] final thought\n");
	});

	test("agent_complete with empty buffer does nothing", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const cb = renderer.createCallback("Bug Hunter");

		cb({ type: "agent_complete" });
		expect(lines.length).toBe(0);
	});

	test("multiple agents get different color tags", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const bug = renderer.createCallback("Bug Hunter");
		const test = renderer.createCallback("Test Reviewer");

		bug({ type: "text_delta", delta: "bug line\n" });
		test({ type: "text_delta", delta: "test line\n" });

		expect(lines.length).toBe(2);

		// Both should have correct agent name prefixes
		expect(stripAnsi(lines[0])).toBe("[Bug Hunter] bug line\n");
		expect(stripAnsi(lines[1])).toBe("[Test Reviewer] test line\n");

		// They should have different colors (raw strings differ)
		expect(lines[0]).not.toBe(lines[1].replace("Test Reviewer", "Bug Hunter").replace("test line", "bug line"));
	});

	test("output includes ANSI color codes", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const cb = renderer.createCallback("Bug Hunter");

		cb({ type: "text_delta", delta: "hello\n" });

		// Raw output should contain ANSI codes
		expect(lines[0]).toContain("\x1b[");
		// But stripped version should not
		expect(stripAnsi(lines[0])).not.toContain("\x1b[");
	});

	test("tool_start output is dimmed", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const cb = renderer.createCallback("Bug Hunter");

		cb({
			type: "tool_start",
			toolName: "read",
			args: { path: "foo.ts" },
		});

		// Should contain DIM escape code
		expect(lines[0]).toContain("\x1b[2m");
	});

	test("flush() flushes all agents", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const bug = renderer.createCallback("Bug Hunter");
		const quality = renderer.createCallback("Code Quality");

		bug({ type: "text_delta", delta: "pending bug" });
		quality({ type: "text_delta", delta: "pending quality" });
		expect(lines.length).toBe(0);

		renderer.flush();
		expect(lines.length).toBe(2);
		const stripped = lines.map(stripAnsi);
		expect(stripped).toContain("[Bug Hunter] pending bug\n");
		expect(stripped).toContain("[Code Quality] pending quality\n");
	});

	test("interleaved events from multiple agents stay readable", () => {
		const { lines, write } = captureOutput();
		const renderer = createVerboseRenderer(write);
		const bug = renderer.createCallback("Bug Hunter");
		const test = renderer.createCallback("Test Reviewer");

		// Simulate interleaved streaming
		bug({ type: "text_delta", delta: "I'll analyze " });
		test({ type: "text_delta", delta: "Let me check " });
		bug({ type: "text_delta", delta: "the diff\n" });
		test({ type: "text_delta", delta: "tests\n" });

		expect(lines.length).toBe(2);
		const stripped = lines.map(stripAnsi);
		// Each line belongs to its own agent, not interleaved
		expect(stripped[0]).toBe("[Bug Hunter] I'll analyze the diff\n");
		expect(stripped[1]).toBe("[Test Reviewer] Let me check tests\n");
	});
});

// ── Spinner Renderer ────────────────────────────────────────────────

describe("createSpinnerRenderer", () => {
	test("tool_start updates spinner", () => {
		const updates: string[] = [];
		const spinner = { update: (text: string) => updates.push(text) };
		let completed = 0;
		const renderer = createSpinnerRenderer(
			spinner,
			() => completed,
			4,
		);
		const cb = renderer.createCallback("Bug Hunter");

		cb({
			type: "tool_start",
			toolName: "read",
			args: { path: "src/cli.ts" },
		});

		expect(updates.length).toBe(1);
		const stripped = stripAnsi(updates[0]);
		expect(stripped).toBe("0/4 complete [Bug Hunter] read src/cli.ts");
	});

	test("completed count updates dynamically", () => {
		const updates: string[] = [];
		const spinner = { update: (text: string) => updates.push(text) };
		let completed = 0;
		const renderer = createSpinnerRenderer(
			spinner,
			() => completed,
			4,
		);
		const bug = renderer.createCallback("Bug Hunter");
		const test = renderer.createCallback("Test Reviewer");

		bug({
			type: "tool_start",
			toolName: "read",
			args: { path: "a.ts" },
		});
		expect(stripAnsi(updates[0])).toStartWith("0/4");

		completed = 1;
		test({
			type: "tool_start",
			toolName: "grep",
			args: { pattern: "test" },
		});
		expect(stripAnsi(updates[1])).toStartWith("1/4");
	});

	test("text_delta does not update spinner", () => {
		const updates: string[] = [];
		const spinner = { update: (text: string) => updates.push(text) };
		const renderer = createSpinnerRenderer(spinner, () => 0, 4);
		const cb = renderer.createCallback("Bug Hunter");

		cb({ type: "text_delta", delta: "some text" });

		expect(updates.length).toBe(0);
	});

	test("agent_complete updates spinner with done message", () => {
		const updates: string[] = [];
		const spinner = { update: (text: string) => updates.push(text) };
		const renderer = createSpinnerRenderer(spinner, () => 0, 4);
		const cb = renderer.createCallback("Bug Hunter");

		cb({ type: "agent_complete" });

		expect(updates.length).toBe(1);
		const stripped = stripAnsi(updates[0]);
		expect(stripped).toBe("1/4 complete [Bug Hunter] done");
	});

	test("spinner output includes colored agent name", () => {
		const updates: string[] = [];
		const spinner = { update: (text: string) => updates.push(text) };
		const renderer = createSpinnerRenderer(spinner, () => 0, 4);
		const cb = renderer.createCallback("Bug Hunter");

		cb({
			type: "tool_start",
			toolName: "read",
			args: { path: "x.ts" },
		});

		// Raw output should contain ANSI codes
		expect(updates[0]).toContain("\x1b[");
		expect(updates[0]).toContain("[Bug Hunter]");
	});

	test("different agents get different colors in spinner", () => {
		const updates: string[] = [];
		const spinner = { update: (text: string) => updates.push(text) };
		const renderer = createSpinnerRenderer(spinner, () => 0, 4);
		const bug = renderer.createCallback("Bug Hunter");
		const quality = renderer.createCallback("Code Quality");

		bug({
			type: "tool_start",
			toolName: "read",
			args: { path: "a.ts" },
		});
		quality({
			type: "tool_start",
			toolName: "read",
			args: { path: "b.ts" },
		});

		// Both have agent names but the raw ANSI-colored strings differ
		expect(stripAnsi(updates[0])).toContain("[Bug Hunter]");
		expect(stripAnsi(updates[1])).toContain("[Code Quality]");
		// Extract the color code before each agent name
		const colorBug = updates[0].match(/(\x1b\[\d+m)\[Bug/)?.[1];
		const colorQuality = updates[1].match(/(\x1b\[\d+m)\[Code/)?.[1];
		expect(colorBug).toBeDefined();
		expect(colorQuality).toBeDefined();
		expect(colorBug).not.toBe(colorQuality);
	});

	test("flush is a no-op", () => {
		const updates: string[] = [];
		const spinner = { update: (text: string) => updates.push(text) };
		const renderer = createSpinnerRenderer(spinner, () => 0, 4);

		renderer.createCallback("Bug Hunter")({
			type: "text_delta",
			delta: "buffered text",
		});

		renderer.flush();
		// Spinner renderer doesn't buffer, so flush shouldn't produce output
		expect(updates.length).toBe(0);
	});
});
