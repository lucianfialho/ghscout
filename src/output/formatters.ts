export interface ScoredCluster {
  name: string;
  issues: Array<{
    number: number;
    title: string;
    htmlUrl: string;
    reactions: { total: number };
    createdAt: string;
  }>;
  issueCount: number;
  totalReactions: number;
  labels: string[];
  score: number;
  breakdown: {
    demand: number;
    frequency: number;
    frustration: number;
    marketSize: number;
    gap: number;
  };
}

export interface OutputOptions {
  format: "json" | "table" | "pretty";
  top?: number;
}

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function useColor(): boolean {
  return !process.env["NO_COLOR"];
}

function c(code: string, text: string): string {
  if (!useColor()) return text;
  return `${code}${text}${RESET}`;
}

function scoreColor(score: number): string {
  if (score > 70) return GREEN;
  if (score >= 40) return YELLOW;
  return RED;
}

function sliceClusters(
  clusters: ScoredCluster[],
  top?: number
): ScoredCluster[] {
  // Push "other" cluster to the end
  const sorted = [...clusters].sort((a, b) => {
    if (a.name === "other") return 1;
    if (b.name === "other") return -1;
    return 0;
  });
  if (top !== undefined && top > 0) {
    return sorted.slice(0, top);
  }
  return sorted;
}

function formatJson(clusters: ScoredCluster[], top?: number): string {
  const sliced = sliceClusters(clusters, top);
  return JSON.stringify({
    meta: {
      scannedAt: new Date().toISOString(),
      clusterCount: sliced.length,
    },
    clusters: sliced,
  });
}

function formatTable(clusters: ScoredCluster[], top?: number): string {
  const items = sliceClusters(clusters, top);

  const headers = ["#", "Score", "Cluster", "Issues", "Reactions", "Top Issue"];
  const rows = items.map((cluster, i) => {
    let topIssueTitle = "";
    if (cluster.issues.length > 0) {
      const best = cluster.issues
        .slice()
        .sort((a, b) => b.reactions.total - a.reactions.total)[0];
      topIssueTitle =
        best.title.length > 30 ? best.title.slice(0, 30) + "..." : best.title;
    }
    return [
      String(i + 1),
      String(cluster.score),
      cluster.name,
      String(cluster.issueCount),
      String(cluster.totalReactions),
      topIssueTitle,
    ];
  });

  // Calculate column widths
  const widths = headers.map((h, col) =>
    Math.max(h.length, ...rows.map((r) => r[col].length))
  );

  const headerLine = headers
    .map((h, i) => h.padEnd(widths[i]))
    .join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => cell.padEnd(widths[i])).join("  ")
  );

  return [headerLine, separator, ...dataLines].join("\n");
}

function formatPretty(clusters: ScoredCluster[], top?: number): string {
  const items = sliceClusters(clusters, top);
  const lines: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const cluster = items[i];
    const color = scoreColor(cluster.score);
    const rank = `#${i + 1}`;
    const scoreText = `[${cluster.score}/100]`;
    lines.push(c(BOLD, `${rank} `) + c(color, scoreText) + ` ${cluster.name}`);

    const labelsStr =
      cluster.labels.length > 0 ? cluster.labels.join(", ") : "none";
    lines.push(
      `   Issues: ${cluster.issueCount} | Reactions: ${cluster.totalReactions} | Labels: ${labelsStr}`
    );

    const b = cluster.breakdown;
    lines.push(
      `   Demand: ${b.demand}  Frequency: ${b.frequency}  Frustration: ${b.frustration}  Market: ${b.marketSize}  Gap: ${b.gap}`
    );

    // Show top 2 issues by reactions
    const sortedIssues = cluster.issues
      .slice()
      .sort((a, b) => b.reactions.total - a.reactions.total)
      .slice(0, 2);

    for (const issue of sortedIssues) {
      const truncTitle =
        issue.title.length > 70
          ? issue.title.slice(0, 70) + "..."
          : issue.title;
      const ageDays = Math.floor(
        (Date.now() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      lines.push(
        c(DIM, `   → [${issue.reactions.total} 👍] ${truncTitle} (${ageDays}d)`)
      );
      lines.push(c(DIM, `     ${issue.htmlUrl}`));
    }

    if (cluster.issues.length > 2) {
      lines.push(c(DIM, `   (showing top 2 issues by reactions)`));
    }

    if (i < items.length - 1) {
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function formatScanResult(
  clusters: ScoredCluster[],
  opts: OutputOptions
): string {
  switch (opts.format) {
    case "json":
      return formatJson(clusters, opts.top);
    case "table":
      return formatTable(clusters, opts.top);
    case "pretty":
      return formatPretty(clusters, opts.top);
  }
}

// --- AI-scored output ---

export interface AIScoredCluster extends ScoredCluster {
  aiScore: number;
  verdict: "BUILD" | "SKIP" | "WATCH";
  rationale: string;
}

function verdictColor(verdict: string): string {
  if (verdict === "BUILD") return GREEN;
  if (verdict === "WATCH") return YELLOW;
  return RED;
}

function formatAIPretty(clusters: AIScoredCluster[], top?: number): string {
  const items = top && top > 0 ? clusters.slice(0, top) : clusters;
  const lines: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const cluster = items[i];
    const rank = `#${i + 1}`;
    const vColor = verdictColor(cluster.verdict);
    const scoreText = `[${cluster.aiScore}/10]`;

    lines.push(
      c(BOLD, `${rank} `) +
        c(vColor, scoreText) +
        ` ${cluster.name}` +
        "  " +
        c(vColor, cluster.verdict),
    );

    lines.push(
      `   Issues: ${cluster.issueCount} | Reactions: ${cluster.totalReactions} | Heuristic: ${cluster.score}/100`,
    );

    lines.push(c(DIM, `   AI: "${cluster.rationale}"`));

    // Show top 2 issues
    const sortedIssues = cluster.issues
      .slice()
      .sort((a, b) => b.reactions.total - a.reactions.total)
      .slice(0, 2);

    for (const issue of sortedIssues) {
      const truncTitle =
        issue.title.length > 70
          ? issue.title.slice(0, 70) + "..."
          : issue.title;
      const ageDays = Math.floor(
        (Date.now() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      lines.push(
        c(DIM, `   → [${issue.reactions.total} 👍] ${truncTitle} (${ageDays}d)`),
      );
      lines.push(c(DIM, `     ${issue.htmlUrl}`));
    }

    if (i < items.length - 1) {
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function formatAIScanResult(
  clusters: AIScoredCluster[],
  opts: OutputOptions,
): string {
  switch (opts.format) {
    case "json":
      return JSON.stringify({
        meta: {
          scannedAt: new Date().toISOString(),
          clusterCount: clusters.length,
          scoringMethod: "ai",
        },
        clusters: opts.top && opts.top > 0 ? clusters.slice(0, opts.top) : clusters,
      });
    case "table": {
      const items = opts.top && opts.top > 0 ? clusters.slice(0, opts.top) : clusters;
      const headers = ["#", "AI", "Verdict", "Cluster", "Issues", "Reactions", "Rationale"];
      const rows = items.map((cl, i) => [
        String(i + 1),
        String(cl.aiScore),
        cl.verdict,
        cl.name,
        String(cl.issueCount),
        String(cl.totalReactions),
        cl.rationale.length > 40 ? cl.rationale.slice(0, 40) + "..." : cl.rationale,
      ]);
      const widths = headers.map((h, col) =>
        Math.max(h.length, ...rows.map((r) => r[col].length)),
      );
      const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join("  ");
      const separator = widths.map((w) => "-".repeat(w)).join("  ");
      const dataLines = rows.map((row) =>
        row.map((cell, i) => cell.padEnd(widths[i])).join("  "),
      );
      return [headerLine, separator, ...dataLines].join("\n");
    }
    case "pretty":
      return formatAIPretty(clusters, opts.top);
  }
}
