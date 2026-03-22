import { resolveToken } from "../github/auth.js";
import { GitHubClient, RateLimitError } from "../github/client.js";
import { detectWorkarounds } from "../analysis/signals.js";
import type { Issue } from "../github/types.js";

export interface EvidenceOptions {
  output: string;
  sort: string;
  limit: number;
  verbose: boolean;
  noCache: boolean;
}

interface SearchIssuesResponse {
  total_count: number;
  items: Array<{
    number: number;
    title: string;
    body: string | null;
    labels: Array<{ name: string }>;
    reactions: { "+1": number; "-1": number; total_count: number };
    comments: number;
    created_at: string;
    html_url: string;
    user: { login: string };
    state: string;
    pull_request?: unknown;
  }>;
}

function verbose(msg: string, enabled: boolean): void {
  if (enabled) {
    process.stderr.write(msg + "\n");
  }
}

function mapToIssue(item: SearchIssuesResponse["items"][0]): Issue {
  return {
    number: item.number,
    title: item.title,
    body: item.body ?? "",
    labels: item.labels.map((l) => l.name),
    reactions: {
      thumbsUp: item.reactions["+1"],
      thumbsDown: item.reactions["-1"],
      total: item.reactions.total_count,
    },
    commentsCount: item.comments,
    createdAt: item.created_at,
    htmlUrl: item.html_url,
    user: item.user.login,
    state: item.state,
  };
}

function daysAgo(dateStr: string): number {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function sortParam(sort: string): string {
  if (sort === "reactions") return "reactions-+1";
  if (sort === "comments") return "comments";
  return "created";
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function useColor(): boolean {
  return !process.env["NO_COLOR"];
}

function c(code: string, text: string): string {
  if (!useColor()) return text;
  return `${code}${text}${RESET}`;
}

interface PRItem {
  number: number;
  title: string;
  html_url: string;
  state: string;
  pull_request?: { merged_at: string | null };
  reactions: { "+1": number; total_count: number };
}

interface EvidenceSummary {
  totalIssues: number;
  uniqueUsers: number;
  totalReactions: number;
  relatedPRs: number;
}

interface EvidenceResult {
  summary: EvidenceSummary;
  issues: Issue[];
  prs: Array<{
    number: number;
    title: string;
    htmlUrl: string;
    status: string;
    reactions: number;
  }>;
}

function formatJson(result: EvidenceResult): string {
  return JSON.stringify({
    summary: result.summary,
    issues: result.issues,
  });
}

function formatTable(result: EvidenceResult): string {
  const headers = ["#", "Reactions", "Title", "Age", "Comments", "URL"];
  const rows = result.issues.map((issue, i) => [
    String(i + 1),
    String(issue.reactions.thumbsUp),
    issue.title.length > 50 ? issue.title.slice(0, 47) + "..." : issue.title,
    `${daysAgo(issue.createdAt)}d`,
    String(issue.commentsCount),
    issue.htmlUrl,
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

function formatPretty(
  result: EvidenceResult,
  repo: string,
  query: string,
  sortBy: string,
): string {
  const lines: string[] = [];

  lines.push(c(BOLD, `Evidence: "${query}" in ${repo}`));
  lines.push("");
  lines.push("Summary:");
  lines.push(`  Issues found:    ${result.summary.totalIssues}`);
  lines.push(`  Unique authors:  ${result.summary.uniqueUsers}`);
  lines.push(`  Total \u{1F44D}:        ${result.summary.totalReactions}`);
  lines.push(`  Related PRs:     ${result.summary.relatedPRs}`);
  lines.push("");

  const sortLabel =
    sortBy === "reactions"
      ? "reactions"
      : sortBy === "comments"
        ? "comments"
        : "recent";
  lines.push(`Issues (sorted by ${sortLabel}):`);

  for (let i = 0; i < result.issues.length; i++) {
    const issue = result.issues[i];
    const age = daysAgo(issue.createdAt);
    const labelsStr =
      issue.labels.length > 0 ? ` | labels: ${issue.labels.join(", ")}` : "";
    lines.push(
      `  ${i + 1}. [${issue.reactions.thumbsUp} \u{1F44D}] ${issue.title}`,
    );
    lines.push(`     ${issue.htmlUrl}`);
    lines.push(
      c(
        DIM,
        `     opened ${age} days ago | ${issue.commentsCount} comments${labelsStr}`,
      ),
    );
  }

  if (result.prs.length > 0) {
    lines.push("");
    lines.push("Related PRs:");
    for (const pr of result.prs) {
      const statusTag = pr.status === "merged" ? "MERGED" : "REJECTED";
      const reactionsStr =
        pr.reactions > 0 ? ` (${pr.reactions} \u{1F44D})` : "";
      lines.push(
        `  - [${statusTag}] ${pr.title} #${pr.number}${reactionsStr}`,
      );
    }
  }

  return lines.join("\n");
}

export async function runEvidence(
  repo: string,
  query: string,
  opts: EvidenceOptions,
): Promise<void> {
  // 1. Validate repo format
  if (!repo || !repo.includes("/")) {
    console.error(
      `Error: Invalid repo format "${repo}". Expected "owner/repo" (e.g., "vercel/next.js").`,
    );
    process.exit(1);
  }

  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    console.error(
      `Error: Invalid repo format "${repo}". Expected "owner/repo" (e.g., "vercel/next.js").`,
    );
    process.exit(1);
  }

  try {
    // 2. Resolve auth, create client
    const token = await resolveToken();
    const client = new GitHubClient(token);

    // 3. Search issues matching query
    const sortValue = sortParam(opts.sort);
    const issueQ = `repo:${repo}+${encodeURIComponent(query)}+in:title,body`;
    verbose(
      `Searching issues: q=${issueQ}&sort=${sortValue}&per_page=${opts.limit}`,
      opts.verbose,
    );

    const issueSearch = await client.get<SearchIssuesResponse>(
      "https://api.github.com/search/issues",
      {
        q: `repo:${repo} ${query} in:title,body`,
        per_page: String(opts.limit),
        sort: sortValue,
      },
    );

    // 4. Map results to Issue type
    const issues: Issue[] = issueSearch.items
      .filter((item) => !item.pull_request)
      .map(mapToIssue);

    // 5. Detect workaround signals
    const workarounds = detectWorkarounds(issues);
    verbose(`Found ${workarounds.length} workaround signals`, opts.verbose);

    // 6. Calculate summary stats
    const uniqueUsers = new Set(issues.map((i) => i.user));
    const totalReactions = issues.reduce(
      (sum, i) => sum + i.reactions.thumbsUp,
      0,
    );

    // 7. Search for related PRs
    verbose("Searching related PRs...", opts.verbose);
    const prSearch = await client.get<SearchIssuesResponse>(
      "https://api.github.com/search/issues",
      {
        q: `repo:${repo} ${query} is:pr`,
        per_page: "20",
      },
    );

    const prs = prSearch.items.map((item) => {
      const prItem = item as unknown as PRItem;
      const merged = prItem.pull_request?.merged_at !== null;
      return {
        number: prItem.number,
        title: prItem.title,
        htmlUrl: prItem.html_url,
        status: merged ? "merged" : "rejected",
        reactions: prItem.reactions["+1"],
      };
    });

    const summary: EvidenceSummary = {
      totalIssues: issues.length,
      uniqueUsers: uniqueUsers.size,
      totalReactions,
      relatedPRs: prs.length,
    };

    const result: EvidenceResult = { summary, issues, prs };

    // 8. Format output
    let output: string;
    switch (opts.output) {
      case "json":
        output = formatJson(result);
        break;
      case "table":
        output = formatTable(result);
        break;
      default:
        output = formatPretty(result, repo, query, opts.sort);
        break;
    }

    console.log(output);
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      console.error(
        `Rate limit exhausted. Resets at ${new Date(error.resetAt * 1000).toISOString()}. Try again later or authenticate with a GitHub token.`,
      );
      process.exit(1);
    }

    if (error instanceof Error) {
      const msg = error.message;
      if (msg.includes("404")) {
        console.error(
          `Repository "${repo}" not found. Check the owner/repo name and try again.`,
        );
        process.exit(1);
      }
      console.error(`Error: ${msg}`);
      process.exit(1);
    }

    console.error("An unexpected error occurred.");
    process.exit(1);
  }
}
