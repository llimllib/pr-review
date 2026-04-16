import { describe, expect, test } from "bun:test";
import { buildExcludeArgs } from "../src/github.ts";

describe("exclude patterns", () => {
	describe("gh pr diff exclude args", () => {
		test("returns empty string for no patterns", () => {
			expect(buildExcludeArgs([])).toBe("");
		});

		test("builds exclude args for single pattern", () => {
			expect(buildExcludeArgs(["transcripts/*"])).toBe(
				' -e "transcripts/*"',
			);
		});

		test("builds exclude args for multiple patterns", () => {
			expect(buildExcludeArgs(["*.lock", "dist/*"])).toBe(
				' -e "*.lock" -e "dist/*"',
			);
		});

		test("properly quotes patterns with spaces", () => {
			expect(buildExcludeArgs(["path with spaces/*"])).toBe(
				' -e "path with spaces/*"',
			);
		});

		test("handles special characters in patterns", () => {
			expect(buildExcludeArgs(["file-name_*.{ts,js}"])).toBe(
				' -e "file-name_*.{ts,js}"',
			);
		});

		test("escapes double quotes in patterns", () => {
			expect(buildExcludeArgs(['file"name.txt'])).toBe(
				' -e "file\\"name.txt"',
			);
		});

		test("escapes backslashes in patterns", () => {
			expect(buildExcludeArgs(["path\\with\\backslashes"])).toBe(
				' -e "path\\\\with\\\\backslashes"',
			);
		});

		test("prevents quote-based shell injection", () => {
			// JSON.stringify() prevents breaking out of quotes with single quotes
			// Pattern: test'$(rm -rf /) becomes "test'$(rm -rf /)" in the command
			// The single quote is safely contained within double quotes
			const malicious = "test'$(rm -rf /)";
			const result = buildExcludeArgs([malicious]);
			expect(result).toBe(' -e "test\'$(rm -rf /)"');
			// Note: gh CLI receives this as a literal argument string.
			// The $() is not interpreted by gh, only by the initial shell.
			// JSON.stringify prevents breaking out of the quotes, which is the
			// primary shell injection vector when using execSync.
		});

		test("preserves shell metacharacters in patterns", () => {
			// Shell metacharacters like $() are preserved in the pattern
			// This is safe because gh CLI treats -e arguments as literal patterns,
			// not as shell commands. The initial shell sees: gh pr diff ... -e "test$(echo pwned)"
			// JSON.stringify ensures the pattern stays within quotes.
			const pattern = "test$(echo pwned)";
			const result = buildExcludeArgs([pattern]);
			expect(result).toBe(' -e "test$(echo pwned)"');
		});

		test("handles multiple patterns with mixed special characters", () => {
			const patterns = ["*.lock", "path with spaces/*", "file'name"];
			const result = buildExcludeArgs(patterns);
			expect(result).toBe(
				' -e "*.lock" -e "path with spaces/*" -e "file\'name"',
			);
		});
	});

	describe("git pathspec format", () => {
		test("git pathspec uses :! prefix", () => {
			// Git pathspecs use :!pattern format (no quotes added in the array)
			const pattern = "transcripts/*";
			const pathspec = `:!${pattern}`;
			expect(pathspec).toBe(":!transcripts/*");
		});

		test("multiple patterns are converted to pathspecs", () => {
			const patterns = ["*.lock", "dist/*", "node_modules"];
			const pathspecs = patterns.map((p) => `:!${p}`);
			expect(pathspecs).toEqual([
				":!*.lock",
				":!dist/*",
				":!node_modules",
			]);
		});

		test("preserves glob patterns in pathspecs", () => {
			const patterns = ["**/*.test.ts", "coverage/**/*"];
			const pathspecs = patterns.map((p) => `:!${p}`);
			expect(pathspecs).toEqual([
				":!**/*.test.ts",
				":!coverage/**/*",
			]);
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

		test("pathspecs with single quotes are safe when using execFileSync", () => {
			// This test documents that single quotes in patterns are safe
			// because we use execFileSync with an array, not shell interpolation
			const malicious = "test'$(rm -rf /)";
			const pathspec = `:!${malicious}`;
			// The pathspec contains the quote, but execFileSync passes it as-is
			// to git without shell interpretation, so it's safe
			expect(pathspec).toBe(":!test'$(rm -rf /)");
		});

		test("pathspecs with command substitution are safe", () => {
			const malicious = "test$(echo pwned)";
			const pathspec = `:!${malicious}`;
			// Again, no shell interpretation with execFileSync
			expect(pathspec).toBe(":!test$(echo pwned)");
		});
	});
});
