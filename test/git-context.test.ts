import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	formatGitDiffContext,
	parseGitDiffArgs,
	type GitDiffContext,
} from "../src/git-context.ts";

// Create a temporary git repo for testing
let testDir: string;
let commit1: string;
let commit2: string;
let commit3: string;

beforeAll(() => {
	testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-review-test-"));

	// Initialize git repo
	execFileSync("git", ["init"], { cwd: testDir });
	execFileSync("git", ["config", "user.name", "Test User"], { cwd: testDir });
	execFileSync("git", ["config", "user.email", "test@example.com"], {
		cwd: testDir,
	});

	// Create three commits
	fs.writeFileSync(path.join(testDir, "file1.txt"), "content1\n");
	execFileSync("git", ["add", "file1.txt"], { cwd: testDir });
	execFileSync("git", ["commit", "-m", "commit 1"], { cwd: testDir });
	commit1 = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: testDir,
		encoding: "utf-8",
	}).trim();

	fs.writeFileSync(path.join(testDir, "file2.txt"), "content2\n");
	execFileSync("git", ["add", "file2.txt"], { cwd: testDir });
	execFileSync("git", ["commit", "-m", "commit 2"], { cwd: testDir });
	commit2 = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: testDir,
		encoding: "utf-8",
	}).trim();

	fs.writeFileSync(path.join(testDir, "file3.txt"), "content3\n");
	execFileSync("git", ["add", "file3.txt"], { cwd: testDir });
	execFileSync("git", ["commit", "-m", "commit 3"], { cwd: testDir });
	commit3 = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: testDir,
		encoding: "utf-8",
	}).trim();

	// Create an uncommitted change for working tree tests
	fs.writeFileSync(path.join(testDir, "file4.txt"), "uncommitted\n");
});

afterAll(() => {
	// Clean up test directory
	if (testDir) {
		fs.rmSync(testDir, { recursive: true, force: true });
	}
});

describe("parseGitDiffArgs", () => {
	test("no args returns HEAD vs working tree", () => {
		const result = parseGitDiffArgs([], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit3);
		expect(result?.target).toBe("working tree");
		expect(result?.baseRef).toBe("HEAD");
		expect(result?.targetRef).toBeUndefined();
	});

	test("single commit ref vs working tree", () => {
		const result = parseGitDiffArgs(["HEAD~1"], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit2);
		expect(result?.target).toBe("working tree");
		expect(result?.baseRef).toBe("HEAD~1");
		expect(result?.targetRef).toBeUndefined();
	});

	test("two commit refs", () => {
		const result = parseGitDiffArgs(["HEAD~2", "HEAD~1"], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit1);
		expect(result?.target).toBe(commit2);
		expect(result?.baseRef).toBe("HEAD~2");
		expect(result?.targetRef).toBe("HEAD~1");
	});

	test("two-dot range syntax (HEAD~2..HEAD~1)", () => {
		const result = parseGitDiffArgs(["HEAD~2..HEAD~1"], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit1);
		expect(result?.target).toBe(commit2);
		expect(result?.baseRef).toBe("HEAD~2");
		expect(result?.targetRef).toBe("HEAD~1");
	});

	test("three-dot range syntax (HEAD~2...HEAD~1)", () => {
		const result = parseGitDiffArgs(["HEAD~2...HEAD~1"], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit1);
		expect(result?.target).toBe(commit2);
		expect(result?.baseRef).toBe("HEAD~2");
		expect(result?.targetRef).toBe("HEAD~1");
	});

	test("--cached flag returns index comparison", () => {
		// Stage a file first
		fs.writeFileSync(path.join(testDir, "staged.txt"), "staged content\n");
		execFileSync("git", ["add", "staged.txt"], { cwd: testDir });

		const result = parseGitDiffArgs(["--cached"], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit3);
		expect(result?.target).toBe("index");
		expect(result?.baseRef).toBe("HEAD");

		// Clean up
		execFileSync("git", ["reset", "HEAD", "staged.txt"], { cwd: testDir });
		fs.unlinkSync(path.join(testDir, "staged.txt"));
	});

	test("--staged flag returns index comparison", () => {
		// Stage a file first
		fs.writeFileSync(path.join(testDir, "staged.txt"), "staged content\n");
		execFileSync("git", ["add", "staged.txt"], { cwd: testDir });

		const result = parseGitDiffArgs(["--staged"], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit3);
		expect(result?.target).toBe("index");
		expect(result?.baseRef).toBe("HEAD");

		// Clean up
		execFileSync("git", ["reset", "HEAD", "staged.txt"], { cwd: testDir });
		fs.unlinkSync(path.join(testDir, "staged.txt"));
	});

	test("--cached with commit ref", () => {
		// Stage a file first
		fs.writeFileSync(path.join(testDir, "staged.txt"), "staged content\n");
		execFileSync("git", ["add", "staged.txt"], { cwd: testDir });

		const result = parseGitDiffArgs(["--cached", "HEAD~1"], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit2);
		expect(result?.target).toBe("index");
		expect(result?.baseRef).toBe("HEAD~1");

		// Clean up
		execFileSync("git", ["reset", "HEAD", "staged.txt"], { cwd: testDir });
		fs.unlinkSync(path.join(testDir, "staged.txt"));
	});

	test("filters out -U option and its argument", () => {
		const result = parseGitDiffArgs(["-U5", "HEAD~1"], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit2);
		expect(result?.target).toBe("working tree");
		expect(result?.baseRef).toBe("HEAD~1");
	});

	test("filters out --unified option", () => {
		const result = parseGitDiffArgs(["--unified=10", "HEAD~1"], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit2);
		expect(result?.target).toBe("working tree");
		expect(result?.baseRef).toBe("HEAD~1");
	});

	test("filters out -e/--exclude options", () => {
		const result = parseGitDiffArgs(
			["-e", "*.lock", "--exclude", "*.json", "HEAD~1"],
			testDir,
		);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit2);
		expect(result?.target).toBe("working tree");
		expect(result?.baseRef).toBe("HEAD~1");
	});

	test("filters out :! pathspecs", () => {
		const result = parseGitDiffArgs([":!*.lock", "HEAD~1"], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit2);
		expect(result?.target).toBe("working tree");
		expect(result?.baseRef).toBe("HEAD~1");
	});

	test("handles -- separator correctly", () => {
		const result = parseGitDiffArgs(["HEAD~1", "--", "src/"], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit2);
		expect(result?.target).toBe("working tree");
		expect(result?.baseRef).toBe("HEAD~1");
	});

	test("handles range with -- separator", () => {
		const result = parseGitDiffArgs(
			["HEAD~2..HEAD~1", "--", "*.txt"],
			testDir,
		);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit1);
		expect(result?.target).toBe(commit2);
		expect(result?.baseRef).toBe("HEAD~2");
		expect(result?.targetRef).toBe("HEAD~1");
	});

	test("handles pathspecs after --", () => {
		const result = parseGitDiffArgs(
			["--", "file1.txt", "file2.txt"],
			testDir,
		);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit3);
		expect(result?.target).toBe("working tree");
		expect(result?.baseRef).toBe("HEAD");
	});

	test("returns null when git rev-parse fails", () => {
		const result = parseGitDiffArgs(["nonexistent-ref"], testDir);
		expect(result).toBeNull();
	});

	test("returns null in non-git directory", () => {
		const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "non-git-"));
		const result = parseGitDiffArgs([], nonGitDir);
		expect(result).toBeNull();
		fs.rmSync(nonGitDir, { recursive: true, force: true });
	});

	test("handles commit SHA directly", () => {
		const result = parseGitDiffArgs([commit1], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit1);
		expect(result?.target).toBe("working tree");
		expect(result?.baseRef).toBe(commit1);
	});

	test("handles two commit SHAs", () => {
		const result = parseGitDiffArgs([commit1, commit2], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit1);
		expect(result?.target).toBe(commit2);
		expect(result?.baseRef).toBe(commit1);
		expect(result?.targetRef).toBe(commit2);
	});

	test("handles range with short SHAs", () => {
		const short1 = commit1.substring(0, 7);
		const short2 = commit2.substring(0, 7);
		const result = parseGitDiffArgs([`${short1}..${short2}`], testDir);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit1);
		expect(result?.target).toBe(commit2);
		expect(result?.baseRef).toBe(short1);
		expect(result?.targetRef).toBe(short2);
	});

	test("ignores extra commit refs beyond first two", () => {
		const result = parseGitDiffArgs(
			["HEAD~2", "HEAD~1", "HEAD"],
			testDir,
		);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit1);
		expect(result?.target).toBe(commit2);
		expect(result?.baseRef).toBe("HEAD~2");
		expect(result?.targetRef).toBe("HEAD~1");
	});

	test("handles mixed flags and refs", () => {
		const result = parseGitDiffArgs(
			["-U10", "--exclude", "*.lock", "HEAD~1", ":!*.json"],
			testDir,
		);
		expect(result).not.toBeNull();
		expect(result?.base).toBe(commit2);
		expect(result?.target).toBe("working tree");
		expect(result?.baseRef).toBe("HEAD~1");
	});
});

describe("formatGitDiffContext", () => {
	test("formats working tree comparison with ref", () => {
		const context: GitDiffContext = {
			base: commit1,
			target: "working tree",
			baseRef: "HEAD~2",
		};
		const result = formatGitDiffContext(context);
		expect(result).toBe(
			`Reviewing changes: HEAD~2 (${commit1.substring(0, 7)}) → working tree`,
		);
	});

	test("formats working tree comparison without ref", () => {
		const context: GitDiffContext = {
			base: commit1,
			target: "working tree",
		};
		const result = formatGitDiffContext(context);
		const shortSha = commit1.substring(0, 7);
		expect(result).toBe(
			`Reviewing changes: ${shortSha} (${shortSha}) → working tree`,
		);
	});

	test("formats index comparison", () => {
		const context: GitDiffContext = {
			base: commit2,
			target: "index",
			baseRef: "HEAD~1",
		};
		const result = formatGitDiffContext(context);
		expect(result).toBe(
			`Reviewing staged changes: HEAD~1 (${commit2.substring(0, 7)}) → index`,
		);
	});

	test("formats index comparison without ref", () => {
		const context: GitDiffContext = {
			base: commit2,
			target: "index",
		};
		const result = formatGitDiffContext(context);
		const shortSha = commit2.substring(0, 7);
		expect(result).toBe(
			`Reviewing staged changes: ${shortSha} (${shortSha}) → index`,
		);
	});

	test("formats commit-to-commit with both refs", () => {
		const context: GitDiffContext = {
			base: commit1,
			target: commit2,
			baseRef: "HEAD~2",
			targetRef: "HEAD~1",
		};
		const result = formatGitDiffContext(context);
		expect(result).toBe(
			`Reviewing changes: HEAD~2 (${commit1.substring(0, 7)}) → HEAD~1 (${commit2.substring(0, 7)})`,
		);
	});

	test("formats commit-to-commit with only target ref", () => {
		const context: GitDiffContext = {
			base: commit1,
			target: commit2,
			targetRef: "HEAD",
		};
		const result = formatGitDiffContext(context);
		const shortBase = commit1.substring(0, 7);
		expect(result).toBe(
			`Reviewing changes: ${shortBase} (${shortBase}) → HEAD (${commit2.substring(0, 7)})`,
		);
	});

	test("formats commit-to-commit without refs", () => {
		const context: GitDiffContext = {
			base: commit1,
			target: commit2,
		};
		const result = formatGitDiffContext(context);
		const shortBase = commit1.substring(0, 7);
		const shortTarget = commit2.substring(0, 7);
		expect(result).toBe(
			`Reviewing changes: ${shortBase} (${shortBase}) → ${shortTarget} (${shortTarget})`,
		);
	});

	test("handles short SHAs gracefully", () => {
		const shortSha = "abc1234";
		const context: GitDiffContext = {
			base: shortSha,
			target: "working tree",
			baseRef: "main",
		};
		const result = formatGitDiffContext(context);
		expect(result).toBe(
			`Reviewing changes: main (${shortSha}) → working tree`,
		);
	});

	test("handles very short SHAs", () => {
		const shortSha = "abc";
		const context: GitDiffContext = {
			base: shortSha,
			target: "working tree",
		};
		const result = formatGitDiffContext(context);
		expect(result).toBe(
			`Reviewing changes: ${shortSha} (${shortSha}) → working tree`,
		);
	});

	test("handles full 40-character SHAs", () => {
		const fullSha = "a".repeat(40);
		const context: GitDiffContext = {
			base: fullSha,
			target: "working tree",
			baseRef: "feature-branch",
		};
		const result = formatGitDiffContext(context);
		expect(result).toBe(
			`Reviewing changes: feature-branch (${fullSha.substring(0, 7)}) → working tree`,
		);
	});

	test("handles branch names with slashes", () => {
		const context: GitDiffContext = {
			base: commit1,
			target: commit2,
			baseRef: "feature/add-tests",
			targetRef: "main",
		};
		const result = formatGitDiffContext(context);
		expect(result).toBe(
			`Reviewing changes: feature/add-tests (${commit1.substring(0, 7)}) → main (${commit2.substring(0, 7)})`,
		);
	});

	test("handles refs with special characters", () => {
		const context: GitDiffContext = {
			base: commit1,
			target: commit2,
			baseRef: "HEAD~2",
			targetRef: "HEAD^",
		};
		const result = formatGitDiffContext(context);
		expect(result).toBe(
			`Reviewing changes: HEAD~2 (${commit1.substring(0, 7)}) → HEAD^ (${commit2.substring(0, 7)})`,
		);
	});
});
