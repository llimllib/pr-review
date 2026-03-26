import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { createSandboxedReadOnlyTools } from "../src/tools.ts";

describe("createSandboxedReadOnlyTools", () => {
	const cwd = "/home/user/project";
	const tools = createSandboxedReadOnlyTools(cwd);

	function getTool(name: string) {
		const tool = tools.find((t) => t.name === name);
		if (!tool) throw new Error(`Tool ${name} not found`);
		return tool;
	}

	describe("path traversal prevention", () => {
		const traversalCases = [
			{ desc: "parent directory with ..", path: "../.ssh/id_rsa" },
			{ desc: "deeply nested ..", path: "../../etc/passwd" },
			{ desc: "absolute path outside cwd", path: "/etc/passwd" },
			{ desc: "home directory via ~", path: "~/.ssh/id_rsa" },
			{ desc: "tilde home", path: "~/secrets" },
			{
				desc: "sneaky .. after valid prefix",
				path: "src/../../.ssh/id_rsa",
			},
		];

		for (const toolName of ["read", "grep", "find", "ls"]) {
			describe(`${toolName} tool`, () => {
				for (const { desc, path: badPath } of traversalCases) {
					test(`rejects ${desc}: ${badPath}`, async () => {
						const tool = getTool(toolName);
						const params: Record<string, unknown> =
							toolName === "grep"
								? { pattern: "test", path: badPath }
								: { path: badPath };

						await expect(
							tool.execute("test-call", params),
						).rejects.toThrow("Access denied");
					});
				}
			});
		}
	});

	describe("allowed paths", () => {
		// These paths should NOT be rejected by the sandbox
		// (they may still fail because the files don't exist, but the
		// error should not be "Access denied")
		const allowedCases = [
			{ desc: "simple relative path", path: "src/main.ts" },
			{ desc: "current directory", path: "." },
			{ desc: "nested path", path: "src/utils/helper.ts" },
			{
				desc: "absolute path within cwd",
				path: `${cwd}/src/main.ts`,
			},
			{ desc: "undefined path (defaults to cwd)", path: undefined },
		];

		for (const toolName of ["read", "ls"]) {
			describe(`${toolName} tool`, () => {
				for (const { desc, path: goodPath } of allowedCases) {
					test(`allows ${desc}`, async () => {
						const tool = getTool(toolName);
						const params: Record<string, unknown> = {};
						if (goodPath !== undefined) {
							params.path = goodPath;
						}

						try {
							await tool.execute("test-call", params);
						} catch (e: unknown) {
							const msg =
								e instanceof Error ? e.message : String(e);
							// The path is allowed by our sandbox, but the file
							// may not exist — that's fine. Just ensure we
							// didn't get our sandbox error.
							expect(msg).not.toContain("Access denied");
						}
					});
				}
			});
		}
	});

	test("returns all four read-only tools", () => {
		const names = tools.map((t) => t.name);
		expect(names).toContain("read");
		expect(names).toContain("grep");
		expect(names).toContain("find");
		expect(names).toContain("ls");
		expect(names).toHaveLength(4);
	});

	test("tools preserve name and description", () => {
		for (const tool of tools) {
			expect(tool.name).toBeTruthy();
			expect(tool.description).toBeTruthy();
		}
	});
});

describe("edge cases", () => {
	test("cwd with trailing slash", () => {
		const tools = createSandboxedReadOnlyTools("/home/user/project/");
		const read = tools.find((t) => t.name === "read")!;

		expect(
			read.execute("test", { path: "../../etc/passwd" }),
		).rejects.toThrow("Access denied");
	});

	test("cwd that needs normalization", () => {
		const tools = createSandboxedReadOnlyTools(
			"/home/user/./project/../project",
		);
		const read = tools.find((t) => t.name === "read")!;

		expect(
			read.execute("test", { path: "../../etc/passwd" }),
		).rejects.toThrow("Access denied");
	});

	test("path with @ prefix is handled", async () => {
		const tools = createSandboxedReadOnlyTools("/home/user/project");
		const read = tools.find((t) => t.name === "read")!;

		// @~/.ssh should be treated as ~/.ssh after stripping @
		await expect(
			read.execute("test", { path: "@~/.ssh/id_rsa" }),
		).rejects.toThrow("Access denied");
	});

	test("@ prefix with valid path is allowed", async () => {
		const tools = createSandboxedReadOnlyTools("/home/user/project");
		const read = tools.find((t) => t.name === "read")!;

		try {
			await read.execute("test", { path: "@src/main.ts" });
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).not.toContain("Access denied");
		}
	});

	test("tilde path throws when HOME is unset", async () => {
		const tools = createSandboxedReadOnlyTools("/home/user/project");
		const read = tools.find((t) => t.name === "read")!;

		const origHome = process.env.HOME;
		const origUserProfile = process.env.USERPROFILE;
		try {
			delete process.env.HOME;
			delete process.env.USERPROFILE;

			await expect(
				read.execute("test", { path: "~/.ssh/id_rsa" }),
			).rejects.toThrow("Cannot resolve ~");
		} finally {
			if (origHome !== undefined) process.env.HOME = origHome;
			else delete process.env.HOME;
			if (origUserProfile !== undefined)
				process.env.USERPROFILE = origUserProfile;
			else delete process.env.USERPROFILE;
		}
	});

	test("empty path string is allowed (defaults to cwd)", async () => {
		const tools = createSandboxedReadOnlyTools("/home/user/project");
		const ls = tools.find((t) => t.name === "ls")!;

		try {
			await ls.execute("test", { path: "" });
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			expect(msg).not.toContain("Access denied");
		}
	});
});
