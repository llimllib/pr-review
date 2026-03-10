import { describe, expect, test } from "bun:test";
import {
	MAX_CONTEXT_FILE_BYTES,
	processContextFiles,
} from "../src/context.ts";

describe("processContextFiles", () => {
	test("passes through small files unchanged", () => {
		const files = [
			{ path: "/project/CLAUDE.md", content: "# Project\nSome guidelines." },
			{ path: "/project/AGENTS.md", content: "# Agents\nMore info." },
		];

		const { files: result, warnings } = processContextFiles(files);

		expect(result).toEqual(files);
		expect(warnings).toEqual([]);
	});

	test("passes through empty file list", () => {
		const { files, warnings } = processContextFiles([]);

		expect(files).toEqual([]);
		expect(warnings).toEqual([]);
	});

	test("passes through file exactly at the limit", () => {
		const content = "x".repeat(MAX_CONTEXT_FILE_BYTES);
		const files = [{ path: "/project/CLAUDE.md", content }];

		const { files: result, warnings } = processContextFiles(files);

		expect(result[0].content).toBe(content);
		expect(warnings).toEqual([]);
	});

	test("truncates file exceeding the limit", () => {
		const content = "x".repeat(MAX_CONTEXT_FILE_BYTES + 1000);
		const files = [{ path: "/project/CLAUDE.md", content }];

		const { files: result, warnings } = processContextFiles(files);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe("/project/CLAUDE.md");
		// Should contain the truncation marker
		expect(result[0].content).toContain("[... truncated");
		// Should mention the original size
		const originalKB = ((MAX_CONTEXT_FILE_BYTES + 1000) / 1024).toFixed(1);
		expect(result[0].content).toContain(`${originalKB}KB`);
		// Truncated output should fit within the limit
		expect(result[0].content.length).toBeLessThanOrEqual(MAX_CONTEXT_FILE_BYTES);
		// Should be shorter than the original
		expect(result[0].content.length).toBeLessThan(content.length);
	});

	test("generates a warning for truncated files", () => {
		const content = "x".repeat(MAX_CONTEXT_FILE_BYTES + 500);
		const files = [{ path: "/project/BIG_CLAUDE.md", content }];

		const { warnings } = processContextFiles(files);

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("/project/BIG_CLAUDE.md");
		expect(warnings[0]).toContain("truncating to");
		expect(warnings[0]).toContain("--no-project-context");
	});

	test("only truncates files that exceed the limit", () => {
		const smallContent = "small file";
		const bigContent = "y".repeat(MAX_CONTEXT_FILE_BYTES + 2000);
		const files = [
			{ path: "/project/CLAUDE.md", content: smallContent },
			{ path: "/project/sub/AGENTS.md", content: bigContent },
		];

		const { files: result, warnings } = processContextFiles(files);

		expect(result).toHaveLength(2);
		// First file unchanged
		expect(result[0].content).toBe(smallContent);
		// Second file truncated and within limit
		expect(result[1].content).toContain("[... truncated");
		expect(result[1].content.length).toBeLessThanOrEqual(MAX_CONTEXT_FILE_BYTES);
		// One warning for the big file
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("/project/sub/AGENTS.md");
	});

	test("respects custom maxBytes parameter", () => {
		const content = "x".repeat(200);
		const files = [{ path: "/project/CLAUDE.md", content }];

		// With limit of 100
		const { files: result, warnings } = processContextFiles(files, 100);

		expect(result[0].content).toContain("[... truncated");
		expect(result[0].content.length).toBeLessThanOrEqual(100);
		expect(warnings).toHaveLength(1);
	});

	test("custom maxBytes: file at exact limit passes through", () => {
		const content = "12345";
		const files = [{ path: "/project/CLAUDE.md", content }];

		const { files: result, warnings } = processContextFiles(files, 5);

		expect(result[0].content).toBe("12345");
		expect(warnings).toEqual([]);
	});

	test("custom maxBytes smaller than marker still works", () => {
		const content = "abcdefghij"; // 10 bytes
		const files = [{ path: "/project/CLAUDE.md", content }];

		// Limit of 5 is smaller than the marker itself; should still
		// produce a truncated result without crashing
		const { files: result, warnings } = processContextFiles(files, 5);

		expect(result[0].content).toContain("[... truncated");
		expect(warnings).toHaveLength(1);
	});

	test("generates separate warnings for multiple truncated files", () => {
		const bigContent = "z".repeat(MAX_CONTEXT_FILE_BYTES + 100);
		const files = [
			{ path: "/project/CLAUDE.md", content: bigContent },
			{ path: "/parent/AGENTS.md", content: bigContent },
		];

		const { files: result, warnings } = processContextFiles(files);

		expect(result).toHaveLength(2);
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain("/project/CLAUDE.md");
		expect(warnings[1]).toContain("/parent/AGENTS.md");
	});

	test("preserves file paths through truncation", () => {
		const files = [
			{
				path: "/some/deeply/nested/path/CLAUDE.md",
				content: "a".repeat(MAX_CONTEXT_FILE_BYTES + 1),
			},
		];

		const { files: result } = processContextFiles(files);

		expect(result[0].path).toBe("/some/deeply/nested/path/CLAUDE.md");
	});

	test("truncation marker includes original file size in KB", () => {
		// Create a file that's exactly 10KB
		const content = "b".repeat(10 * 1024);
		const files = [{ path: "/project/CLAUDE.md", content }];

		const { files: result } = processContextFiles(files);

		expect(result[0].content).toContain("10.0KB");
	});

	test("does not mutate input array", () => {
		const originalContent = "c".repeat(MAX_CONTEXT_FILE_BYTES + 100);
		const files = [{ path: "/project/CLAUDE.md", content: originalContent }];
		const originalLength = files[0].content.length;

		processContextFiles(files);

		expect(files[0].content.length).toBe(originalLength);
	});
});
