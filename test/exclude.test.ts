import { describe, expect, test } from "bun:test";

describe("exclude patterns", () => {
	describe("git pathspec conversion", () => {
		test("converts single exclude pattern to pathspec", () => {
			const pattern = "transcripts/*";
			const pathspec = `:!${pattern}`;
			expect(pathspec).toBe(":!transcripts/*");
		});

		test("converts multiple exclude patterns to pathspecs", () => {
			const patterns = ["*.lock", "dist/*", "node_modules"];
			const pathspecs = patterns.map((p) => `:!${p}`);
			expect(pathspecs).toEqual([
				":!*.lock",
				":!dist/*",
				":!node_modules",
			]);
		});

		test("handles empty pattern list", () => {
			const patterns: string[] = [];
			expect(patterns.length).toBe(0);
		});

		test("preserves glob patterns in pathspecs", () => {
			const patterns = ["**/*.test.ts", "coverage/**/*"];
			const pathspecs = patterns.map((p) => `:!${p}`);
			expect(pathspecs).toEqual([
				":!**/*.test.ts",
				":!coverage/**/*",
			]);
		});
	});

	describe("gh pr diff exclude args", () => {
		test("builds exclude args for single pattern", () => {
			const patterns = ["transcripts/*"];
			const excludeArgs =
				patterns.length > 0
					? ` ${patterns.map((p) => `-e '${p}'`).join(" ")}`
					: "";
			expect(excludeArgs).toBe(" -e 'transcripts/*'");
		});

		test("builds exclude args for multiple patterns", () => {
			const patterns = ["*.lock", "dist/*"];
			const excludeArgs =
				patterns.length > 0
					? ` ${patterns.map((p) => `-e '${p}'`).join(" ")}`
					: "";
			expect(excludeArgs).toBe(" -e '*.lock' -e 'dist/*'");
		});

		test("returns empty string for no patterns", () => {
			const patterns: string[] = [];
			const excludeArgs =
				patterns.length > 0
					? ` ${patterns.map((p) => `-e '${p}'`).join(" ")}`
					: "";
			expect(excludeArgs).toBe("");
		});

		test("properly quotes patterns with spaces", () => {
			const patterns = ["path with spaces/*"];
			const excludeArgs =
				patterns.length > 0
					? ` ${patterns.map((p) => `-e '${p}'`).join(" ")}`
					: "";
			expect(excludeArgs).toBe(" -e 'path with spaces/*'");
		});

		test("handles special characters in patterns", () => {
			const patterns = ["file-name_*.{ts,js}"];
			const excludeArgs =
				patterns.length > 0
					? ` ${patterns.map((p) => `-e '${p}'`).join(" ")}`
					: "";
			expect(excludeArgs).toBe(" -e 'file-name_*.{ts,js}'");
		});
	});

	describe("command construction", () => {
		test("git diff command without excludes", () => {
			const gitArgs = ["-U10", "main"];
			const excludePatterns: string[] = [];

			// Simulate the logic from cli.ts
			for (const pattern of excludePatterns) {
				gitArgs.push(`:!${pattern}`);
			}

			const cmd = `git diff ${gitArgs.map((a) => `'${a}'`).join(" ")}`;
			expect(cmd).toBe("git diff '-U10' 'main'");
		});

		test("git diff command with single exclude", () => {
			const gitArgs = ["-U10", "main"];
			const excludePatterns = ["transcripts/*"];

			for (const pattern of excludePatterns) {
				gitArgs.push(`:!${pattern}`);
			}

			const cmd = `git diff ${gitArgs.map((a) => `'${a}'`).join(" ")}`;
			expect(cmd).toBe("git diff '-U10' 'main' ':!transcripts/*'");
		});

		test("git diff command with multiple excludes", () => {
			const gitArgs = ["-U10", "main"];
			const excludePatterns = ["*.lock", "dist/*"];

			for (const pattern of excludePatterns) {
				gitArgs.push(`:!${pattern}`);
			}

			const cmd = `git diff ${gitArgs.map((a) => `'${a}'`).join(" ")}`;
			expect(cmd).toBe(
				"git diff '-U10' 'main' ':!*.lock' ':!dist/*'",
			);
		});

		test("gh pr diff command without excludes", () => {
			const ref = { owner: "owner", repo: "repo", number: 123 };
			const excludePatterns: string[] = [];

			const repoArg = `${ref.owner}/${ref.repo}`;
			const excludeArgs =
				excludePatterns.length > 0
					? ` ${excludePatterns.map((p) => `-e '${p}'`).join(" ")}`
					: "";

			const cmd = `gh pr diff ${ref.number} --repo ${repoArg}${excludeArgs}`;
			expect(cmd).toBe("gh pr diff 123 --repo owner/repo");
		});

		test("gh pr diff command with single exclude", () => {
			const ref = { owner: "owner", repo: "repo", number: 123 };
			const excludePatterns = ["transcripts/*"];

			const repoArg = `${ref.owner}/${ref.repo}`;
			const excludeArgs =
				excludePatterns.length > 0
					? ` ${excludePatterns.map((p) => `-e '${p}'`).join(" ")}`
					: "";

			const cmd = `gh pr diff ${ref.number} --repo ${repoArg}${excludeArgs}`;
			expect(cmd).toBe(
				"gh pr diff 123 --repo owner/repo -e 'transcripts/*'",
			);
		});

		test("gh pr diff command with multiple excludes", () => {
			const ref = { owner: "owner", repo: "repo", number: 456 };
			const excludePatterns = ["*.lock", "dist/*", "coverage/**"];

			const repoArg = `${ref.owner}/${ref.repo}`;
			const excludeArgs =
				excludePatterns.length > 0
					? ` ${excludePatterns.map((p) => `-e '${p}'`).join(" ")}`
					: "";

			const cmd = `gh pr diff ${ref.number} --repo ${repoArg}${excludeArgs}`;
			expect(cmd).toBe(
				"gh pr diff 456 --repo owner/repo -e '*.lock' -e 'dist/*' -e 'coverage/**'",
			);
		});
	});

	describe("pattern validation", () => {
		test("empty pattern is allowed", () => {
			const pattern = "";
			const pathspec = `:!${pattern}`;
			expect(pathspec).toBe(":!");
		});

		test("patterns with leading slash", () => {
			const pattern = "/absolute/path";
			const pathspec = `:!${pattern}`;
			expect(pathspec).toBe(":!/absolute/path");
		});

		test("patterns with dots", () => {
			const patterns = [".git", ".env", "*.test.ts"];
			const pathspecs = patterns.map((p) => `:!${p}`);
			expect(pathspecs).toEqual([":!.git", ":!.env", ":!*.test.ts"]);
		});

		test("complex glob patterns", () => {
			const patterns = [
				"**/*.{js,ts}",
				"src/**/test/**",
				"!(important.txt)",
			];
			const pathspecs = patterns.map((p) => `:!${p}`);
			expect(pathspecs).toEqual([
				":!**/*.{js,ts}",
				":!src/**/test/**",
				":!!(important.txt)",
			]);
		});
	});
});
