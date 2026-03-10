import { Marked } from "marked";

export interface ReviewData {
	id: string;
	timestamp: string;
	model: string;
	agents: string[];
	diff: string;
	reports: Record<string, string>;
	summary: string;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function generateHtml(data: ReviewData): string {
	const marked = new Marked();
	const summaryHtml = marked.parse(data.summary) as string;

	const agentSections = data.agents
		.map((agentName) => {
			const report = data.reports[agentName];
			if (!report) return "";
			const reportHtml = marked.parse(report) as string;
			return `
      <details class="agent-section">
        <summary class="agent-header">${escapeHtml(agentName)}</summary>
        <div class="agent-content">${reportHtml}</div>
      </details>`;
		})
		.join("\n");

	const date = new Date(data.timestamp);
	const formattedDate = date.toLocaleDateString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Code Review — ${escapeHtml(data.id)}</title>
<style>
  :root {
    --bg: #ffffff;
    --fg: #1a1a2e;
    --muted: #6b7280;
    --border: #e5e7eb;
    --accent: #2563eb;
    --accent-light: #eff6ff;
    --code-bg: #f3f4f6;
    --success: #059669;
    --warning: #d97706;
    --danger: #dc2626;
    --section-bg: #fafafa;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f172a;
      --fg: #e2e8f0;
      --muted: #94a3b8;
      --border: #334155;
      --accent: #60a5fa;
      --accent-light: #1e293b;
      --code-bg: #1e293b;
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #f87171;
      --section-bg: #1e293b;
    }
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.6;
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  .header {
    border-bottom: 2px solid var(--border);
    padding-bottom: 1rem;
    margin-bottom: 2rem;
  }

  .header h1 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }

  .header .meta {
    color: var(--muted);
    font-size: 0.875rem;
  }

  .header .meta span {
    margin-right: 1.5rem;
  }

  .summary-section {
    margin-bottom: 2rem;
  }

  .summary-section h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--accent);
  }

  .agent-section {
    margin-bottom: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .agent-header {
    padding: 0.75rem 1rem;
    background: var(--section-bg);
    cursor: pointer;
    font-weight: 600;
    font-size: 1rem;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .agent-header::-webkit-details-marker { display: none; }

  .agent-header::before {
    content: "▶";
    font-size: 0.75rem;
    transition: transform 0.2s;
    color: var(--muted);
  }

  details[open] > .agent-header::before {
    transform: rotate(90deg);
  }

  .agent-content {
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--border);
  }

  /* Markdown content styles */
  .summary-section h1, .agent-content h1,
  .summary-section h2, .agent-content h2,
  .summary-section h3, .agent-content h3 {
    margin-top: 1.25rem;
    margin-bottom: 0.5rem;
  }

  .summary-section h1, .agent-content h1 { font-size: 1.25rem; }
  .summary-section h2, .agent-content h2 { font-size: 1.1rem; color: var(--fg); }
  .summary-section h3, .agent-content h3 { font-size: 1rem; }

  .summary-section p, .agent-content p {
    margin-bottom: 0.75rem;
  }

  .summary-section ul, .agent-content ul,
  .summary-section ol, .agent-content ol {
    margin-bottom: 0.75rem;
    padding-left: 1.5rem;
  }

  .summary-section li, .agent-content li {
    margin-bottom: 0.25rem;
  }

  code {
    background: var(--code-bg);
    padding: 0.15rem 0.35rem;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: "SF Mono", "Fira Code", "JetBrains Mono", Menlo, monospace;
  }

  pre {
    background: var(--code-bg);
    padding: 1rem;
    border-radius: 8px;
    overflow-x: auto;
    margin-bottom: 0.75rem;
  }

  pre code {
    background: none;
    padding: 0;
  }

  strong { font-weight: 600; }

  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1rem 0;
  }

  blockquote {
    border-left: 3px solid var(--accent);
    padding-left: 1rem;
    color: var(--muted);
    margin-bottom: 0.75rem;
  }

  .agents-heading {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--accent);
  }
</style>
</head>
<body>

<div class="header">
  <h1>Code Review</h1>
  <div class="meta">
    <span>📅 ${escapeHtml(formattedDate)}</span>
    <span>🤖 ${escapeHtml(data.model)}</span>
    <span>🔑 ${escapeHtml(data.id)}</span>
  </div>
</div>

<div class="summary-section">
  <h2>Summary</h2>
  ${summaryHtml}
</div>

<h2 class="agents-heading">Agent Reports</h2>
${agentSections}

</body>
</html>`;
}
