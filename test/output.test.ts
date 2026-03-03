import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawn } from "node:child_process";

// Test the PipedWriter behavior directly
describe("PipedWriter with mdriver", () => {
	test("exits cleanly after streaming content", async () => {
		const proc = spawn("mdriver", ["--color", "always"], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		const exitPromise = new Promise<number>((resolve, reject) => {
			proc.on("close", (code) => resolve(code ?? -1));
			proc.on("error", reject);
		});

		// Simulate streaming writes like the real code does
		proc.stdin.write("# Hello\n\n");
		await new Promise((r) => setTimeout(r, 10));
		proc.stdin.write("This is **bold** text.\n");
		await new Promise((r) => setTimeout(r, 10));
		proc.stdin.write("\nDone!\n");

		proc.stdin.end();

		const code = await exitPromise;
		expect(code).toBe(0);
	});

	test("exits cleanly with large content", async () => {
		const proc = spawn("mdriver", ["--color", "always"], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		const exitPromise = new Promise<number>((resolve, reject) => {
			proc.on("close", (code) => resolve(code ?? -1));
			proc.on("error", reject);
		});

		// Write a larger chunk of markdown
		const content = `# Code Review Summary

## Critical Issues
- Issue 1: Something bad
- Issue 2: Something worse

## Recommendations
1. Fix the first thing
2. Fix the second thing

\`\`\`typescript
const x = 1;
const y = 2;
console.log(x + y);
\`\`\`

## Conclusion
This code needs work.
`;

		proc.stdin.write(content);
		proc.stdin.end();

		const code = await exitPromise;
		expect(code).toBe(0);
	});
});

describe("PipedWriter with cat (simple pipe test)", () => {
	test("exits cleanly after streaming", async () => {
		const proc = spawn("cat", [], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let output = "";
		proc.stdout.on("data", (data) => {
			output += data.toString();
		});

		const exitPromise = new Promise<number>((resolve, reject) => {
			proc.on("close", (code) => resolve(code ?? -1));
			proc.on("error", reject);
		});

		proc.stdin.write("line 1\n");
		proc.stdin.write("line 2\n");
		proc.stdin.write("line 3\n");
		proc.stdin.end();

		const code = await exitPromise;
		expect(code).toBe(0);
		expect(output).toBe("line 1\nline 2\nline 3\n");
	});
});
