import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateHtml } from "../src/html.ts";
import type { FollowUp, ReviewData } from "../src/html.ts";

/**
 * Tests for the follow-up persistence logic.
 * This simulates what continueReview does: loading reports.json,
 * appending a follow-up, and regenerating the HTML.
 */

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-review-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeReviewData(): ReviewData {
	return {
		id: "test-session",
		timestamp: "2026-06-03T12:00:00.000Z",
		model: "anthropic/claude-sonnet-4-6",
		agents: ["bug"],
		diff: "diff content",
		reports: { bug: "No bugs found." },
		summary: "All clear.",
	};
}

describe("follow-up persistence", () => {
	test("appends first follow-up to reports.json without followups field", () => {
		const reportsFile = path.join(tmpDir, "reports.json");
		const reviewData = makeReviewData();
		fs.writeFileSync(reportsFile, JSON.stringify(reviewData));

		// Simulate what continueReview does
		const loaded: ReviewData = JSON.parse(
			fs.readFileSync(reportsFile, "utf-8"),
		);
		const followup: FollowUp = {
			question: "What about edge cases?",
			answer: "Handle them carefully.",
			timestamp: "2026-06-03T13:00:00.000Z",
		};
		if (!loaded.followups) {
			loaded.followups = [];
		}
		loaded.followups.push(followup);
		fs.writeFileSync(reportsFile, JSON.stringify(loaded));

		// Verify
		const result: ReviewData = JSON.parse(
			fs.readFileSync(reportsFile, "utf-8"),
		);
		expect(result.followups).toHaveLength(1);
		expect(result.followups![0]!.question).toBe("What about edge cases?");
		expect(result.followups![0]!.answer).toBe("Handle them carefully.");
	});

	test("appends multiple follow-ups sequentially", () => {
		const reportsFile = path.join(tmpDir, "reports.json");
		const reviewData = makeReviewData();
		reviewData.followups = [
			{
				question: "First question",
				answer: "First answer",
				timestamp: "2026-06-03T13:00:00.000Z",
			},
		];
		fs.writeFileSync(reportsFile, JSON.stringify(reviewData));

		// Simulate second follow-up
		const loaded: ReviewData = JSON.parse(
			fs.readFileSync(reportsFile, "utf-8"),
		);
		loaded.followups!.push({
			question: "Second question",
			answer: "Second answer",
			timestamp: "2026-06-03T14:00:00.000Z",
		});
		fs.writeFileSync(reportsFile, JSON.stringify(loaded));

		const result: ReviewData = JSON.parse(
			fs.readFileSync(reportsFile, "utf-8"),
		);
		expect(result.followups).toHaveLength(2);
		expect(result.followups![0]!.question).toBe("First question");
		expect(result.followups![1]!.question).toBe("Second question");
	});

	test("regenerated HTML includes the new follow-up", () => {
		const reportsFile = path.join(tmpDir, "reports.json");
		const htmlFile = path.join(tmpDir, "review.html");
		const reviewData = makeReviewData();
		fs.writeFileSync(reportsFile, JSON.stringify(reviewData));

		// First: no followups element in HTML
		const htmlBefore = generateHtml(reviewData);
		expect(htmlBefore).not.toContain('<details class="followups-section"');

		// Add a follow-up
		reviewData.followups = [
			{
				question: "How do I fix this?",
				answer: "Refactor the function.",
				timestamp: "2026-06-03T13:00:00.000Z",
			},
		];
		fs.writeFileSync(reportsFile, JSON.stringify(reviewData));
		fs.writeFileSync(htmlFile, generateHtml(reviewData));

		// Now HTML has followups
		const htmlAfter = fs.readFileSync(htmlFile, "utf-8");
		expect(htmlAfter).toContain("followups-section");
		expect(htmlAfter).toContain("How do I fix this?");
		expect(htmlAfter).toContain("Refactor the function.");
	});

	test("preserves all original review data when appending follow-up", () => {
		const reportsFile = path.join(tmpDir, "reports.json");
		const reviewData = makeReviewData();
		reviewData.prUrl = "https://github.com/owner/repo/pull/42";
		reviewData.prCommit = "abc1234567890";
		fs.writeFileSync(reportsFile, JSON.stringify(reviewData));

		// Add follow-up
		const loaded: ReviewData = JSON.parse(
			fs.readFileSync(reportsFile, "utf-8"),
		);
		loaded.followups = [
			{ question: "Q", answer: "A", timestamp: "2026-06-03T13:00:00.000Z" },
		];
		fs.writeFileSync(reportsFile, JSON.stringify(loaded));

		// Verify original data preserved
		const result: ReviewData = JSON.parse(
			fs.readFileSync(reportsFile, "utf-8"),
		);
		expect(result.id).toBe("test-session");
		expect(result.model).toBe("anthropic/claude-sonnet-4-6");
		expect(result.agents).toEqual(["bug"]);
		expect(result.reports.bug).toBe("No bugs found.");
		expect(result.summary).toBe("All clear.");
		expect(result.prUrl).toBe("https://github.com/owner/repo/pull/42");
		expect(result.prCommit).toBe("abc1234567890");
		expect(result.followups).toHaveLength(1);
	});

	test("handles empty answer (no text deltas from model)", () => {
		const reportsFile = path.join(tmpDir, "reports.json");
		const reviewData = makeReviewData();
		fs.writeFileSync(reportsFile, JSON.stringify(reviewData));

		const loaded: ReviewData = JSON.parse(
			fs.readFileSync(reportsFile, "utf-8"),
		);
		loaded.followups = [
			{
				question: "What about this?",
				answer: "",
				timestamp: "2026-06-03T13:00:00.000Z",
			},
		];
		fs.writeFileSync(reportsFile, JSON.stringify(loaded));

		const result: ReviewData = JSON.parse(
			fs.readFileSync(reportsFile, "utf-8"),
		);
		expect(result.followups).toHaveLength(1);
		expect(result.followups![0]!.answer).toBe("");

		// HTML should still render without errors
		const html = generateHtml(result);
		expect(html).toContain("What about this?");
		expect(html).toContain("Q1:");
	});
});
