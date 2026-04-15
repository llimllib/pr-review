import { execSync } from "node:child_process";

interface ExecError extends Error {
	status?: number;
	stderr?: string;
}

export interface PullRequest {
	number: number;
	owner: string;
	repo: string;
	title: string;
	body: string;
	headRefName: string;
	baseRefName: string;
}

export interface GitHubPRReference {
	owner: string;
	repo: string;
	number: number;
}

/**
 * Parse a GitHub PR URL or short reference.
 * Supports:
 * - https://github.com/owner/repo/pull/123
 * - https://github.com/owner/repo/pull/123/files
 * - https://github.com/owner/repo/pull/123/changes
 * - owner/repo#123
 */
export function parseGitHubPR(input: string): GitHubPRReference | null {
	// Try full URL format: https://github.com/owner/repo/pull/123[/anything]
	const urlMatch = input.match(
		/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
	);
	if (urlMatch) {
		return {
			owner: urlMatch[1],
			repo: urlMatch[2],
			number: parseInt(urlMatch[3], 10),
		};
	}

	// Try short format: owner/repo#123
	const shortMatch = input.match(/^([^/]+)\/([^#]+)#(\d+)$/);
	if (shortMatch) {
		return {
			owner: shortMatch[1],
			repo: shortMatch[2],
			number: parseInt(shortMatch[3], 10),
		};
	}

	return null;
}

/**
 * Check if the GitHub CLI is available.
 */
export function isGitHubCLIAvailable(): boolean {
	try {
		execSync("gh --version", { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Fetch PR metadata using the GitHub CLI.
 */
export function fetchPRMetadata(ref: GitHubPRReference): PullRequest {
	const repoArg = `${ref.owner}/${ref.repo}`;

	let output: string;
	try {
		output = execSync(
			`gh pr view ${ref.number} --repo ${repoArg} --json title,body,headRefName,baseRefName`,
			{
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	} catch (err) {
		const execErr = err as ExecError;
		// Check for common error cases
		if (execErr.status === 127) {
			throw new Error(
				"GitHub CLI (gh) is required to fetch PRs. Install: https://cli.github.com",
			);
		}
		if (execErr.status === 4 || execErr.stderr?.includes("authentication")) {
			throw new Error(
				"GitHub authentication required for this repository.\nRun this command to authenticate:\n  gh auth login",
			);
		}
		// Show the actual error from gh
		const stderr = execErr.stderr?.trim() || (err as Error).message;
		throw new Error(`Failed to fetch PR metadata: ${stderr}`);
	}

	const data = JSON.parse(output);
	return {
		number: ref.number,
		owner: ref.owner,
		repo: ref.repo,
		title: data.title || "",
		body: data.body || "",
		headRefName: data.headRefName || "",
		baseRefName: data.baseRefName || "",
	};
}

/**
 * Fetch PR diff using the GitHub CLI.
 */
export function fetchPRDiff(ref: GitHubPRReference): string {
	const repoArg = `${ref.owner}/${ref.repo}`;

	let diff: string;
	try {
		diff = execSync(`gh pr diff ${ref.number} --repo ${repoArg}`, {
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (err) {
		const execErr = err as ExecError;
		if (execErr.status === 127) {
			throw new Error(
				"GitHub CLI (gh) is required to fetch PRs. Install: https://cli.github.com",
			);
		}
		if (execErr.status === 4 || execErr.stderr?.includes("authentication")) {
			throw new Error(
				"GitHub authentication required for this repository.\nRun this command to authenticate:\n  gh auth login",
			);
		}
		const stderr = execErr.stderr?.trim() || (err as Error).message;
		throw new Error(`Failed to fetch PR diff: ${stderr}`);
	}

	return diff.trim();
}

/**
 * Format PR metadata as context for the review.
 */
export function formatPRContext(pr: PullRequest): string {
	let context = `# Pull Request: ${pr.title}\n\n`;
	context += `**Repository:** ${pr.owner}/${pr.repo}\n`;
	context += `**PR:** #${pr.number}\n`;
	context += `**Branches:** ${pr.headRefName} → ${pr.baseRefName}\n\n`;
	context += `## Description\n\n`;
	context += pr.body || "No description provided.";
	return context;
}
