import type { ReviewData } from "./html.ts";

export function generateMarkdown(data: ReviewData): string {
  const date = new Date(data.timestamp);
  const formattedDate = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let md = "# Code Review\n\n";

  // Metadata
  md += `| | |\n|---|---|\n`;
  md += `| **Date** | ${formattedDate} |\n`;
  md += `| **Model** | ${data.model} |\n`;
  md += `| **Session** | \`${data.id}\` |\n`;
  if (data.prUrl) {
    md += `| **PR** | ${data.prUrl} |\n`;
  }
  if (data.prCommit) {
    md += `| **Commit** | \`${data.prCommit.substring(0, 7)}\` |\n`;
  }
  if (data.gitContext) {
    md += `| **Context** | ${data.gitContext} |\n`;
  }
  md += "\n";

  // Summary
  md += `## Summary\n\n${data.summary}\n\n`;

  // Agent reports
  md += "## Agent Reports\n\n";
  for (const agent of data.agents) {
    const report = data.reports[agent];
    if (!report) continue;
    md += `### ${agent}\n\n${report}\n\n---\n\n`;
  }

  // Follow-ups
  if (data.followups && data.followups.length > 0) {
    md += `## Follow-up Discussion\n\n`;
    for (let i = 0; i < data.followups.length; i++) {
      const fu = data.followups[i]!;
      const timestamp = fu.timestamp
        ? ` _(${new Date(fu.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })})_`
        : "";
      md += `**Q${i + 1}:**${timestamp} ${fu.question}\n\n`;
      md += `${fu.answer}\n\n`;
      if (i < data.followups.length - 1) {
        md += "---\n\n";
      }
    }
  }

  return md;
}
