import { Marked } from "marked";

export interface FollowUp {
  question: string;
  answer: string;
  timestamp?: string;
}

export interface ReviewData {
  id: string;
  timestamp: string;
  model: string;
  agents: string[];
  diff: string;
  reports: Record<string, string>;
  summary: string;
  prUrl?: string;
  prCommit?: string;
  gitContext?: string;
  followups?: FollowUp[];
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
      <details class="agent-section" id="agent-${escapeHtml(agentName.toLowerCase().replace(/\s+/g, "-"))}">
        <summary class="agent-header">${escapeHtml(agentName)}</summary>
        <div class="agent-content">${reportHtml}</div>
      </details>`;
    })
    .join("\n");

  // Build follow-ups section if available
  let followupsSection = "";
  if (data.followups && data.followups.length > 0) {
    const followupEntries = data.followups
      .map((fu, idx) => {
        const questionHtml = marked.parse(fu.question) as string;
        const answerHtml = marked.parse(fu.answer) as string;
        const timestamp = fu.timestamp
          ? `<span class="followup-time">${escapeHtml(new Date(fu.timestamp).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit" }))}</span>`
          : "";
        return `
        <div class="followup-entry" id="followup-${idx + 1}">
          <div class="followup-question">
            <span class="followup-label">Q${idx + 1}:</span>${timestamp}
            <div class="followup-question-content">${questionHtml}</div>
          </div>
          <div class="followup-answer">${answerHtml}</div>
        </div>`;
      })
      .join("\n");

    followupsSection = `
    <details class="followups-section" id="followups" open>
      <summary class="followups-header">💬 Follow-up Discussion (${data.followups.length})</summary>
      <div class="followups-content">${followupEntries}</div>
    </details>`;
  }

  const date = new Date(data.timestamp);
  const formattedDate = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Build PR/git info section if available
  let contextSection = "";
  if (data.prUrl && data.prCommit) {
    const shortCommit = data.prCommit.substring(0, 7);
    contextSection = `<span>🔗 <a href="${escapeHtml(data.prUrl)}" target="_blank">${escapeHtml(data.prUrl)}</a></span>
    <span>📌 Commit: <code>${escapeHtml(shortCommit)}</code></span>`;
  } else if (data.prUrl) {
    contextSection = `<span>🔗 <a href="${escapeHtml(data.prUrl)}" target="_blank">${escapeHtml(data.prUrl)}</a></span>`;
  } else if (data.gitContext) {
    contextSection = `<span>📊 ${escapeHtml(data.gitContext)}</span>`;
  }

  // Build TOC entries
  const tocAgents = data.agents
    .filter((name) => data.reports[name])
    .map(
      (name) =>
        `<a href="#agent-${escapeHtml(name.toLowerCase().replace(/\s+/g, "-"))}">${escapeHtml(name)}</a>`,
    )
    .join("\n          ");

  const tocFollowups =
    data.followups && data.followups.length > 0
      ? `<a href="#followups">💬 Follow-ups (${data.followups.length})</a>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Code Review — ${escapeHtml(data.id)}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
  :root {
    --bg: #fdf6e3;
    --fg: #1a1a2e;
    --muted: #6b7280;
    --border: #d4c9a8;
    --accent: #2563eb;
    --accent-light: #fefcf3;
    --code-bg: #f5ecd7;
    --success: #059669;
    --warning: #d97706;
    --danger: #dc2626;
    --section-bg: #faf3e0;
    --sidebar-bg: #f5ecd7;
    --sidebar-width: 220px;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.6;
  }

  .layout {
    display: flex;
    min-height: 100vh;
  }

  /* Sidebar TOC */
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    width: var(--sidebar-width);
    height: 100vh;
    overflow-y: auto;
    background: var(--sidebar-bg);
    border-right: 1px solid var(--border);
    padding: 1.5rem 1rem;
    font-size: 0.85rem;
  }

  .sidebar h2 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-bottom: 0.5rem;
    margin-top: 1rem;
  }

  .sidebar h2:first-child {
    margin-top: 0;
  }

  .sidebar a {
    display: block;
    padding: 0.3rem 0.5rem;
    color: var(--fg);
    text-decoration: none;
    border-radius: 4px;
    transition: background 0.15s;
  }

  .sidebar a:hover {
    background: var(--accent-light);
    color: var(--accent);
  }

  /* Main content */
  .main-content {
    margin-left: var(--sidebar-width);
    padding: 2rem 2.5rem;
    flex: 1;
    min-width: 0;
  }

  /* Constrain prose width for readability, but let code overflow */
  .main-content > .header,
  .main-content > .summary-section,
  .main-content > .agents-heading,
  .main-content > .agent-section,
  .main-content > .followups-section {
    max-width: 900px;
  }

  .summary-section p, .agent-content p, .followup-answer p,
  .followup-question-content p,
  .summary-section ul, .agent-content ul, .followup-answer ul,
  .summary-section ol, .agent-content ol, .followup-answer ol,
  .summary-section blockquote, .agent-content blockquote, .followup-answer blockquote,
  .summary-section table, .agent-content table, .followup-answer table,
  .summary-section h1, .agent-content h1, .followup-answer h1,
  .summary-section h2, .agent-content h2, .followup-answer h2,
  .summary-section h3, .agent-content h3, .followup-answer h3 {
    max-width: 900px;
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
    margin-bottom: 0.25rem;
  }

  .header .meta.pr-info {
    margin-top: 0.5rem;
  }

  .header .meta a {
    color: var(--accent);
    text-decoration: none;
  }

  .header .meta a:hover {
    text-decoration: underline;
  }

  .header .meta span {
    margin-right: 1.5rem;
  }

  .summary-section {
    margin-bottom: 2rem;
  }

  .summary-heading {
    font-size: 1.35rem;
    font-weight: 700;
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
  .summary-section h1, .agent-content h1, .followup-answer h1,
  .summary-section h2, .agent-content h2, .followup-answer h2,
  .summary-section h3, .agent-content h3, .followup-answer h3 {
    margin-top: 1.25rem;
    margin-bottom: 0.5rem;
  }

  .summary-section h1, .agent-content h1, .followup-answer h1 { font-size: 1.25rem; }
  .summary-section h2, .agent-content h2, .followup-answer h2 { font-size: 1.1rem; color: var(--fg); }
  .summary-section h3, .agent-content h3, .followup-answer h3 { font-size: 1rem; }

  .summary-section p, .agent-content p, .followup-answer p,
  .followup-question-content p {
    margin-bottom: 0.75rem;
  }

  .summary-section ul, .agent-content ul, .followup-answer ul,
  .summary-section ol, .agent-content ol, .followup-answer ol {
    margin-bottom: 0.75rem;
    padding-left: 1.5rem;
  }

  .summary-section li, .agent-content li, .followup-answer li {
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
    border-radius: 4px;
    overflow-x: visible;
    margin-bottom: 0.75rem;
    width: max-content;
    min-width: 100%;
  }

  pre code {
    background: none;
    padding: 0;
  }

  /* highlight.js override for our theme */
  .hljs {
    background: var(--code-bg) !important;
  }

  /* Table styles */
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1rem;
    font-size: 0.9rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  thead {
    background: var(--section-bg);
  }

  th {
    padding: 0.6rem 0.75rem;
    text-align: left;
    font-weight: 600;
    border-bottom: 2px solid var(--border);
  }

  td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover {
    background: var(--accent-light);
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

  /* Follow-ups section */
  .followups-section {
    margin-top: 2rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .followups-header {
    padding: 0.75rem 1rem;
    background: var(--section-bg);
    cursor: pointer;
    font-weight: 600;
    font-size: 1.1rem;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .followups-header::-webkit-details-marker { display: none; }

  .followups-header::before {
    content: "▶";
    font-size: 0.75rem;
    transition: transform 0.2s;
    color: var(--muted);
  }

  details[open] > .followups-header::before {
    transform: rotate(90deg);
  }

  .followups-content {
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--border);
  }

  .followup-entry {
    margin-bottom: 1.5rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .followup-entry:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .followup-question {
    margin-bottom: 0.75rem;
  }

  .followup-label {
    font-weight: 700;
    color: var(--accent);
    margin-right: 0.5rem;
  }

  .followup-time {
    font-size: 0.8rem;
    color: var(--muted);
    margin-left: 0.5rem;
  }

  .followup-question-content {
    margin-top: 0.25rem;
    padding-left: 0.5rem;
    border-left: 2px solid var(--accent);
  }

  .followup-answer {
    padding-left: 0.5rem;
  }

  /* Responsive: hide sidebar on small screens */
  @media (max-width: 768px) {
    .sidebar {
      display: none;
    }
    .main-content {
      margin-left: 0;
      padding: 1.5rem 1rem;
    }
  }
</style>
</head>
<body>

<div class="layout">
  <nav class="sidebar">
    <h2>Summary</h2>
    <a href="#summary">📋 Summary Report</a>

    <h2>Agents</h2>
    ${tocAgents}

    ${tocFollowups ? `<h2>Discussion</h2>\n          ${tocFollowups}` : ""}
  </nav>

  <main class="main-content">
    <div class="header">
      <h1>Code Review</h1>
      <div class="meta">
        <span>📅 ${escapeHtml(formattedDate)}</span>
        <span>🤖 ${escapeHtml(data.model)}</span>
        <span>🔑 ${escapeHtml(data.id)}</span>
      </div>
      ${contextSection ? `<div class="meta pr-info">${contextSection}</div>` : ""}
    </div>

    <div class="summary-section" id="summary">
      <h1 class="summary-heading">Summary Agent Report</h1>
      ${summaryHtml}
    </div>

    <h2 class="agents-heading">Agent Reports</h2>
    ${agentSections}

    ${followupsSection}
  </main>
</div>

<script>hljs.highlightAll();</script>
</body>
</html>`;
}
