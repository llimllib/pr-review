import { describe, expect, test } from "bun:test";
import { generateHtml } from "../src/html.ts";
import type { FollowUp, ReviewData } from "../src/html.ts";

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
		summary: "# Summary\n\nNo critical issues.\n\n| # | Issue |\n|---|-------|\n| 1 | None |",
		...overrides,
	};
}

describe("generateHtml", () => {
	test("generates valid HTML with required structure", () => {
		const html = generateHtml(makeReviewData());

		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("<html lang=\"en\">");
		expect(html).toContain("</html>");
	});

	test("includes sidebar TOC with agent links", () => {
		const html = generateHtml(makeReviewData());

		expect(html).toContain('class="sidebar"');
		expect(html).toContain('href="#agent-bug"');
		expect(html).toContain('href="#agent-quality"');
		expect(html).toContain('href="#summary"');
	});

	test("includes agent sections with correct IDs", () => {
		const html = generateHtml(makeReviewData());

		expect(html).toContain('id="agent-bug"');
		expect(html).toContain('id="agent-quality"');
		expect(html).toContain("class=\"agent-section\"");
	});

	test("renders summary section", () => {
		const html = generateHtml(makeReviewData());

		expect(html).toContain('id="summary"');
		expect(html).toContain("Summary Agent Report");
		expect(html).toContain("No critical issues.");
	});

	test("renders markdown in reports", () => {
		const html = generateHtml(makeReviewData());

		// h2 from markdown
		expect(html).toContain("<h2>No bugs found</h2>");
		expect(html).toContain("<h2>Quality is fine</h2>");
	});

	test("renders tables from markdown", () => {
		const html = generateHtml(makeReviewData());

		expect(html).toContain("<table>");
		expect(html).toContain("<th>");
		expect(html).toContain("<td>");
	});

	test("includes highlight.js for syntax highlighting", () => {
		const html = generateHtml(makeReviewData());

		expect(html).toContain("highlight.js");
		expect(html).toContain("hljs.highlightAll()");
	});

	test("uses light khaki background", () => {
		const html = generateHtml(makeReviewData());

		expect(html).toContain("#fdf6e3");
	});

	test("includes code blocks with language class", () => {
		const data = makeReviewData({
			summary: "Example:\n\n```typescript\nconst x = 1;\n```",
		});
		const html = generateHtml(data);

		expect(html).toContain('class="language-typescript"');
	});

	test("escapes HTML in metadata", () => {
		const data = makeReviewData({
			id: "<script>alert('xss')</script>",
		});
		const html = generateHtml(data);

		expect(html).not.toContain("<script>alert('xss')</script>");
		expect(html).toContain("&lt;script&gt;");
	});

	test("includes PR URL when provided", () => {
		const data = makeReviewData({
			prUrl: "https://github.com/owner/repo/pull/123",
			prCommit: "abc1234567890",
		});
		const html = generateHtml(data);

		expect(html).toContain("https://github.com/owner/repo/pull/123");
		expect(html).toContain("abc1234");
	});

	test("includes git context when no PR", () => {
		const data = makeReviewData({
			gitContext: "Comparing main...feature (5 files changed)",
		});
		const html = generateHtml(data);

		expect(html).toContain("Comparing main...feature (5 files changed)");
	});

	test("skips agents with no report", () => {
		const data = makeReviewData({
			agents: ["bug", "missing", "quality"],
			reports: {
				bug: "Found bugs.",
				quality: "Quality ok.",
			},
		});
		const html = generateHtml(data);

		expect(html).toContain('id="agent-bug"');
		expect(html).toContain('id="agent-quality"');
		expect(html).not.toContain('id="agent-missing"');
	});

	test("responsive: hides sidebar on small screens", () => {
		const html = generateHtml(makeReviewData());

		expect(html).toContain("@media (max-width: 768px)");
		expect(html).toContain(".sidebar");
		expect(html).toContain("display: none");
	});

	test("pre blocks allow overflow (no scrollbar)", () => {
		const html = generateHtml(makeReviewData());

		expect(html).toContain("overflow-x: visible");
		expect(html).not.toContain("overflow-x: auto");
	});
});

describe("generateHtml - follow-ups", () => {
	test("does not include followups section when no followups", () => {
		const html = generateHtml(makeReviewData());

		expect(html).not.toContain('<details class="followups-section"');
		expect(html).not.toContain("Follow-up Discussion");
	});

	test("does not include followups section for empty array", () => {
		const html = generateHtml(makeReviewData({ followups: [] }));

		expect(html).not.toContain('<details class="followups-section"');
		expect(html).not.toContain("Discussion");
	});

	test("does not include followups TOC entry when no followups", () => {
		const html = generateHtml(makeReviewData());

		expect(html).not.toContain('href="#followups"');
	});

	test("renders followups section with single followup", () => {
		const followups: FollowUp[] = [
			{
				question: "What about edge cases?",
				answer: "Good point, you should handle null.",
				timestamp: "2026-06-03T13:00:00.000Z",
			},
		];
		const html = generateHtml(makeReviewData({ followups }));

		expect(html).toContain('<details class="followups-section"');
		expect(html).toContain("Follow-up Discussion (1)");
		expect(html).toContain("Q1:");
		expect(html).toContain("What about edge cases?");
		expect(html).toContain("Good point, you should handle null.");
	});

	test("renders multiple followups with correct numbering", () => {
		const followups: FollowUp[] = [
			{
				question: "First question",
				answer: "First answer",
				timestamp: "2026-06-03T13:00:00.000Z",
			},
			{
				question: "Second question",
				answer: "Second answer",
				timestamp: "2026-06-03T14:00:00.000Z",
			},
			{
				question: "Third question",
				answer: "Third answer",
				timestamp: "2026-06-03T15:00:00.000Z",
			},
		];
		const html = generateHtml(makeReviewData({ followups }));

		expect(html).toContain("Follow-up Discussion (3)");
		expect(html).toContain("Q1:");
		expect(html).toContain("Q2:");
		expect(html).toContain("Q3:");
		expect(html).toContain('id="followup-1"');
		expect(html).toContain('id="followup-2"');
		expect(html).toContain('id="followup-3"');
	});

	test("renders followups TOC entry when followups present", () => {
		const followups: FollowUp[] = [
			{ question: "Q", answer: "A", timestamp: "2026-06-03T13:00:00.000Z" },
		];
		const html = generateHtml(makeReviewData({ followups }));

		expect(html).toContain('href="#followups"');
		expect(html).toContain("Follow-ups (1)");
		expect(html).toContain("Discussion");
	});

	test("renders markdown in followup answers", () => {
		const followups: FollowUp[] = [
			{
				question: "Show me code",
				answer: "Here:\n\n```python\ndef foo():\n    pass\n```",
				timestamp: "2026-06-03T13:00:00.000Z",
			},
		];
		const html = generateHtml(makeReviewData({ followups }));

		expect(html).toContain('class="language-python"');
		expect(html).toContain("def foo():");
	});

	test("renders markdown in followup questions", () => {
		const followups: FollowUp[] = [
			{
				question: "What about `null` values?",
				answer: "Handle them.",
			},
		];
		const html = generateHtml(makeReviewData({ followups }));

		expect(html).toContain("<code>null</code>");
	});

	test("handles followup without timestamp", () => {
		const followups: FollowUp[] = [
			{
				question: "No timestamp question",
				answer: "No timestamp answer",
			},
		];
		const html = generateHtml(makeReviewData({ followups }));

		expect(html).toContain("Q1:");
		expect(html).toContain("No timestamp question");
		// No <span class="followup-time"> element should be rendered
		expect(html).not.toContain('<span class="followup-time">');
	});

	test("followups section is open by default", () => {
		const followups: FollowUp[] = [
			{ question: "Q", answer: "A" },
		];
		const html = generateHtml(makeReviewData({ followups }));

		expect(html).toContain('<details class="followups-section" id="followups" open>');
	});

	test("agent names with spaces get correct IDs", () => {
		const data = makeReviewData({
			agents: ["Impact Analysis"],
			reports: { "Impact Analysis": "Some impact analysis." },
		});
		const html = generateHtml(data);

		expect(html).toContain('id="agent-impact-analysis"');
		expect(html).toContain('href="#agent-impact-analysis"');
	});
});
