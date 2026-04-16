import { describe, expect, test } from "bun:test";
import { parseGitHubPR, formatPRContext } from "../src/github.ts";
import type { PullRequest } from "../src/github.ts";

describe("parseGitHubPR", () => {
	test("parses full GitHub PR URLs", () => {
		const result = parseGitHubPR(
			"https://github.com/owner/repo/pull/123",
		);
		expect(result).toEqual({
			owner: "owner",
			repo: "repo",
			number: 123,
		});
	});

	test("parses PR URL with /files suffix", () => {
		const result = parseGitHubPR(
			"https://github.com/owner/repo/pull/456/files",
		);
		expect(result).toEqual({
			owner: "owner",
			repo: "repo",
			number: 456,
		});
	});

	test("parses PR URL with /changes suffix", () => {
		const result = parseGitHubPR(
			"https://github.com/owner/repo/pull/789/changes",
		);
		expect(result).toEqual({
			owner: "owner",
			repo: "repo",
			number: 789,
		});
	});

	test("parses short format owner/repo#123", () => {
		const result = parseGitHubPR("owner/repo#123");
		expect(result).toEqual({
			owner: "owner",
			repo: "repo",
			number: 123,
		});
	});

	test("parses owner and repo with hyphens and underscores", () => {
		const result = parseGitHubPR("my-org/my_repo#42");
		expect(result).toEqual({
			owner: "my-org",
			repo: "my_repo",
			number: 42,
		});
	});

	test("parses repo names with dots", () => {
		const result = parseGitHubPR("owner/repo.name#100");
		expect(result).toEqual({
			owner: "owner",
			repo: "repo.name",
			number: 100,
		});
	});

	test("returns null for invalid URLs", () => {
		expect(parseGitHubPR("not a url")).toBeNull();
		expect(parseGitHubPR("https://gitlab.com/owner/repo/pull/123")).toBeNull();
		expect(parseGitHubPR("https://github.com/owner/repo/issues/123")).toBeNull();
	});

	test("returns null for malformed short format", () => {
		expect(parseGitHubPR("owner/repo")).toBeNull();
		expect(parseGitHubPR("owner#123")).toBeNull();
		expect(parseGitHubPR("repo#123")).toBeNull();
		expect(parseGitHubPR("owner/repo/extra#123")).toBeNull();
	});

	test("returns null for empty string", () => {
		expect(parseGitHubPR("")).toBeNull();
	});

	test("handles large PR numbers", () => {
		const result = parseGitHubPR("owner/repo#999999");
		expect(result).toEqual({
			owner: "owner",
			repo: "repo",
			number: 999999,
		});
	});
});

describe("formatPRContext", () => {
	test("formats basic PR metadata", () => {
		const pr: PullRequest = {
			number: 123,
			owner: "test-owner",
			repo: "test-repo",
			title: "Add new feature",
			body: "This PR adds a great new feature.",
			headRefName: "feature-branch",
			baseRefName: "main",
		};

		const result = formatPRContext(pr);

		expect(result).toContain("# Pull Request: Add new feature");
		expect(result).toContain("**Repository:** test-owner/test-repo");
		expect(result).toContain("**PR:** #123");
		expect(result).toContain("**Branches:** feature-branch → main");
		expect(result).toContain("## Description");
		expect(result).toContain("This PR adds a great new feature.");
	});

	test("handles empty PR body", () => {
		const pr: PullRequest = {
			number: 456,
			owner: "owner",
			repo: "repo",
			title: "Fix bug",
			body: "",
			headRefName: "bugfix",
			baseRefName: "develop",
		};

		const result = formatPRContext(pr);

		expect(result).toContain("Fix bug");
		expect(result).toContain("No description provided.");
	});

	test("preserves markdown formatting in body", () => {
		const pr: PullRequest = {
			number: 789,
			owner: "owner",
			repo: "repo",
			title: "Update docs",
			body: "## Changes\n- Item 1\n- Item 2\n\n**Bold text**",
			headRefName: "docs",
			baseRefName: "main",
		};

		const result = formatPRContext(pr);

		expect(result).toContain("## Changes");
		expect(result).toContain("- Item 1");
		expect(result).toContain("- Item 2");
		expect(result).toContain("**Bold text**");
	});

	test("handles special characters in title", () => {
		const pr: PullRequest = {
			number: 1,
			owner: "owner",
			repo: "repo",
			title: 'Fix: Handle "quotes" & <special> chars',
			body: "Description here",
			headRefName: "fix",
			baseRefName: "main",
		};

		const result = formatPRContext(pr);

		expect(result).toContain('Fix: Handle "quotes" & <special> chars');
	});

	test("handles multiline body with code blocks", () => {
		const pr: PullRequest = {
			number: 2,
			owner: "owner",
			repo: "repo",
			title: "Add feature",
			body: "Example:\n```typescript\nconst x = 1;\n```\nMore text",
			headRefName: "feature",
			baseRefName: "main",
		};

		const result = formatPRContext(pr);

		expect(result).toContain("```typescript");
		expect(result).toContain("const x = 1;");
		expect(result).toContain("More text");
	});
});
