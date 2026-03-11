import { describe, expect, test } from "bun:test";
import { truncateToVisible, visibleLength } from "../src/spinner.ts";

describe("visibleLength", () => {
	test("plain text returns character count", () => {
		expect(visibleLength("hello")).toBe(5);
		expect(visibleLength("")).toBe(0);
	});

	test("ignores ANSI color codes", () => {
		expect(visibleLength("\x1b[36mhello\x1b[0m")).toBe(5);
	});

	test("handles multiple ANSI sequences", () => {
		// "[Bug Hunter]" with color around it + dim text after
		const s = "\x1b[36m[Bug Hunter]\x1b[0m \x1b[2mgrep foo\x1b[0m";
		expect(visibleLength(s)).toBe("[Bug Hunter] grep foo".length);
	});

	test("handles text with no ANSI codes", () => {
		expect(visibleLength("0/4 complete")).toBe(12);
	});

	test("handles adjacent ANSI codes with no text between them", () => {
		expect(visibleLength("\x1b[36m\x1b[0m")).toBe(0);
	});
});

describe("truncateToVisible", () => {
	test("returns original string when it fits", () => {
		expect(truncateToVisible("hello", 10)).toBe("hello");
		expect(truncateToVisible("hello", 5)).toBe("hello");
	});

	test("truncates plain text with ellipsis", () => {
		const result = truncateToVisible("hello world", 5);
		// 4 visible chars + "…"
		expect(result).toContain("hell");
		expect(result).toContain("…");
		expect(visibleLength(result.replace(/\x1b\[[0-9;]*m/g, ""))).toBe(5);
	});

	test("preserves ANSI codes before the cut-off", () => {
		const result = truncateToVisible("\x1b[36mhello world\x1b[0m", 6);
		// Should keep the cyan code, truncate to 5 visible chars + "…"
		expect(result).toContain("\x1b[36m");
		expect(result).toContain("…");
	});

	test("adds reset code after ellipsis", () => {
		const result = truncateToVisible("\x1b[36mhello world\x1b[0m", 6);
		expect(result.endsWith("\x1b[0m")).toBe(true);
	});

	test("handles maxVisible of 1", () => {
		const result = truncateToVisible("hello", 1);
		expect(result).toBe("…\x1b[0m");
	});

	test("handles maxVisible of 0", () => {
		expect(truncateToVisible("hello", 0)).toBe("");
	});

	test("handles negative maxVisible", () => {
		expect(truncateToVisible("hello", -5)).toBe("");
	});

	test("handles string that is exactly maxVisible", () => {
		expect(truncateToVisible("hello", 5)).toBe("hello");
	});

	test("handles string one char over maxVisible", () => {
		const result = truncateToVisible("hello!", 5);
		expect(result).toContain("hell");
		expect(result).toContain("…");
	});

	test("mixed ANSI and plain text truncated correctly", () => {
		// Simulates a real spinner line: "0/4 complete [Bug Hunter] grep some-long-pattern /very/long/path"
		const s =
			"0/4 complete \x1b[36m[Bug Hunter]\x1b[0m \x1b[2mgrep some-long-pattern /very/long/path/to/file\x1b[0m";
		const result = truncateToVisible(s, 40);

		// Should fit in 40 visible chars
		const stripped = result.replace(/\x1b\[[0-9;]*m/g, "");
		expect(stripped.length).toBeLessThanOrEqual(40);
		// Should end with ellipsis (since original is longer than 40)
		expect(stripped.endsWith("…")).toBe(true);
	});

	test("does not truncate when ANSI codes make string look longer than it is", () => {
		// Lots of ANSI codes but only 5 visible chars
		const s = "\x1b[36m\x1b[1mh\x1b[0m\x1b[32me\x1b[0mllo";
		expect(truncateToVisible(s, 10)).toBe(s);
	});

	test("empty string is returned as-is", () => {
		expect(truncateToVisible("", 10)).toBe("");
	});
});
