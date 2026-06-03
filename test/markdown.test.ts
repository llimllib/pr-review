import { describe, expect, test } from "bun:test";
import type { FollowUp, ReviewData } from "../src/html.ts";
import { generateMarkdown } from "../src/markdown.ts";

function makeReviewData(overrides: Partial<ReviewData> = {}): ReviewData {
	return {
		id: "test-session-id",
		timestamp: "2026-06-03T12:00:00.000Z",
		model: "anthropic/claude-sonnet-4-6",
		agents: ["bug", "quality"],
		diff: "diff --git a/foo.ts b/foo.ts\n+console.log('hello')",
		reports: {
			bug: "## No bugs found\n\nLooks good.",
			quality: "## Quality is fine\n\nWell structured.",
		},
		summary: "# Summary\n\nNo critical issues.",
		...overrides,
	};
}

describe("generateMarkdown", () => {
	test("includes title and metadata table", () => {
		const md = generateMarkdown(makeReviewData());

		expect(md).toContain("# Code Review");
		expect(md).toContain("| **Model** | anthropic/claude-sonnet-4-6 |");
		expect(md).toContain("| **Session** | `test-session-id` |");
	});

	test("includes summary section", () => {
		const md = generateMarkdown(makeReviewData());

		expect(md).toContain("## Summary");
		expect(md).toContain("No critical issues.");
	});

	test("includes agent reports", () => {
		const md = generateMarkdown(makeReviewData());

		expect(md).toContain("### bug");
		expect(md).toContain("## No bugs found");
		expect(md).toContain("### quality");
		expect(md).toContain("## Quality is fine");
	});

	test("skips agents with no report", () => {
		const data = makeReviewData({
			agents: ["bug", "missing", "quality"],
			reports: {
				bug: "Found bugs.",
				quality: "Quality ok.",
			},
		});
		const md = generateMarkdown(data);

		expect(md).toContain("### bug");
		expect(md).toContain("### quality");
		expect(md).not.toContain("### missing");
	});

	test("includes PR URL when provided", () => {
		const data = makeReviewData({
			prUrl: "https://github.com/owner/repo/pull/123",
			prCommit: "abc1234567890",
		});
		const md = generateMarkdown(data);

		expect(md).toContain("| **PR** | https://github.com/owner/repo/pull/123 |");
		expect(md).toContain("| **Commit** | `abc1234` |");
	});

	test("includes git context when no PR", () => {
		const data = makeReviewData({
			gitContext: "Comparing main...feature (5 files changed)",
		});
		const md = generateMarkdown(data);

		expect(md).toContain("| **Context** | Comparing main...feature (5 files changed) |");
	});

	test("omits optional metadata rows when not provided", () => {
		const md = generateMarkdown(makeReviewData());

		expect(md).not.toContain("**PR**");
		expect(md).not.toContain("**Commit**");
		expect(md).not.toContain("**Context**");
	});

	test("does not include followups section when no followups", () => {
		const md = generateMarkdown(makeReviewData());

		expect(md).not.toContain("## Follow-up Discussion");
	});

	test("does not include followups section for empty array", () => {
		const md = generateMarkdown(makeReviewData({ followups: [] }));

		expect(md).not.toContain("## Follow-up Discussion");
	});

	test("renders followups with numbering", () => {
		const followups: FollowUp[] = [
			{
				question: "What about edge cases?",
				answer: "Good point, handle null.",
				timestamp: "2026-06-03T13:00:00.000Z",
			},
		];
		const md = generateMarkdown(makeReviewData({ followups }));

		expect(md).toContain("## Follow-up Discussion");
		expect(md).toContain("**Q1:**");
		expect(md).toContain("What about edge cases?");
		expect(md).toContain("Good point, handle null.");
	});

	test("renders multiple followups with separators", () => {
		const followups: FollowUp[] = [
			{ question: "First", answer: "Answer 1", timestamp: "2026-06-03T13:00:00.000Z" },
			{ question: "Second", answer: "Answer 2", timestamp: "2026-06-03T14:00:00.000Z" },
		];
		const md = generateMarkdown(makeReviewData({ followups }));

		expect(md).toContain("**Q1:**");
		expect(md).toContain("**Q2:**");
		// Separator between followups but not after the last one
		const parts = md.split("## Follow-up Discussion")[1]!;
		const separators = parts.match(/^---$/gm);
		expect(separators).toHaveLength(1);
	});

	test("handles followup without timestamp", () => {
		const followups: FollowUp[] = [
			{ question: "No time", answer: "Still works" },
		];
		const md = generateMarkdown(makeReviewData({ followups }));

		expect(md).toContain("**Q1:** No time");
		expect(md).not.toContain("_(");
	});

	test("includes timestamp in followup when provided", () => {
		const followups: FollowUp[] = [
			{
				question: "Timed question",
				answer: "Timed answer",
				timestamp: "2026-06-03T13:30:00.000Z",
			},
		];
		const md = generateMarkdown(makeReviewData({ followups }));

		// Should contain italic timestamp
		expect(md).toMatch(/\*\*Q1:\*\* _\(.+\)_ Timed question/);
	});
});
