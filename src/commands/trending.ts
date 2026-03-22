import { resolveToken } from "../github/auth.js";
import { GitHubClient, RateLimitError } from "../github/client.js";
import { searchReposByTopic } from "../github/fetchers.js";
import { clusterIssues } from "../analysis/cluster.js";
import { scoreClusters } from "../analysis/scorer.js";
import { formatScanResult } from "../output/formatters.js";
import type { OutputOptions } from "../output/formatters.js";
import type { Issue, RepoMeta } from "../github/types.js";

export interface TrendingOptions {
  output: string;
  top: number;
  topic?: string;
  lang?: string;
  verbose: boolean;
  noCache: boolean;
}

const BASE = "https://api.github.com";

function verbose(msg: string, enabled: boolean): void {
  if (enabled) {
    process.stderr.write(msg + "\n");
  }
}

/**
 * Calculate date 30 days ago in ISO 8601 date format (YYYY-MM-DD).
 */
export function thirtyDaysAgo(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().split("T")[0];
}

/**
 * Map a GitHub search issue item to our Issue type.
 */
function mapSearchIssue(item: Record<string, unknown>): Issue {
  const reactions = item.reactions as Record<string, number> | undefined;
  const labels = (item.labels as Array<{ name: string } | string>) ?? [];
  const user = item.user as Record<string, unknown> | undefined;

  return {
    number: item.number as number,
    title: item.title as string,
    body: (item.body as string) ?? "",
    labels: labels.map((l) => (typeof l === "string" ? l : l.name)),
    reactions: {
      thumbsUp: reactions?.["+1"] ?? 0,
      thumbsDown: reactions?.["-1"] ?? 0,
      total: reactions?.total_count ?? 0,
    },
    commentsCount: (item.comments as number) ?? 0,
    createdAt: item.created_at as string,
    htmlUrl: item.html_url as string,
    user: (user?.login as string) ?? "",
    state: item.state as string,
  };
}

/**
 * Extract owner/repo from a repository_url like
 * "https://api.github.com/repos/vercel/next.js"
 */
function repoFromUrl(repositoryUrl: string): string {
  const match = repositoryUrl.match(/repos\/([^/]+\/[^/]+)$/);
  return match ? match[1] : "unknown/unknown";
}

export async function runTrending(opts: TrendingOptions): Promise<void> {
  try {
    // 1. Resolve auth, create client
    const token = await resolveToken();
    const client = new GitHubClient(token);

    const sinceDate = thirtyDaysAgo();
    let issues: Issue[];

    if (opts.topic) {
      // Topic filtering: search repos by topic first, then search issues in those repos
      verbose(`Searching repos for topic "${opts.topic}"...`, opts.verbose);
      const repos = await searchReposByTopic(
        client,
        opts.topic,
        opts.lang,
        500, // min stars for trending
      );

      const topRepos = repos.slice(0, 10);
      if (topRepos.length === 0) {
        console.error(`No repos found for topic "${opts.topic}".`);
        process.exit(1);
      }

      // Search issues in each repo
      const allIssues: Issue[] = [];
      for (let i = 0; i < topRepos.length; i++) {
        const repo = topRepos[i];
        verbose(
          `Searching trending issues in ${repo.fullName} (${i + 1}/${topRepos.length})...`,
          opts.verbose,
        );

        try {
          const repoQuery = `repo:${repo.fullName} reactions:>10 created:>${sinceDate}`;
          const data = await client.get<{
            total_count: number;
            incomplete_results: boolean;
            items: Record<string, unknown>[];
          }>(`${BASE}/search/issues`, {
            q: repoQuery,
            sort: "reactions",
            order: "desc",
            per_page: "100",
          });

          allIssues.push(...data.items.map(mapSearchIssue));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `  Warning: skipped ${repo.fullName} (${msg})\n`,
          );
        }
      }

      issues = allIssues;
    } else {
      // Direct search for high-reaction issues
      let query = `reactions:>10 created:>${sinceDate}`;
      if (opts.lang) {
        query += ` language:${opts.lang}`;
      }

      verbose(`Searching trending issues: ${query}`, opts.verbose);

      const data = await client.get<{
        total_count: number;
        incomplete_results: boolean;
        items: Record<string, unknown>[];
      }>(`${BASE}/search/issues`, {
        q: query,
        sort: "reactions",
        order: "desc",
        per_page: "100",
      });

      issues = data.items.map(mapSearchIssue);
    }

    if (issues.length === 0) {
      console.log("No trending issues found matching your criteria.");
      return;
    }

    verbose(`Found ${issues.length} trending issues, clustering...`, opts.verbose);

    // 5. Cluster the issues
    const clusters = clusterIssues(issues);

    // 6. Create synthetic RepoMeta for scoring
    // Extract repo info from issues to compute average stars (default 5000)
    const syntheticMeta: RepoMeta = {
      owner: "trending",
      repo: "github",
      fullName: "trending/github",
      stars: 5000,
      pushedAt: new Date().toISOString(),
      topics: opts.topic ? [opts.topic] : [],
      language: opts.lang ?? null,
      description: "Trending issues across GitHub",
    };

    // 7. Score clusters
    const scored = scoreClusters(clusters, syntheticMeta, "cross");

    // 8. Format output
    const format = opts.output as OutputOptions["format"];
    const result = formatScanResult(scored, { format, top: opts.top });
    console.log(result);
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      console.error(
        `Rate limit exhausted. Resets at ${new Date(error.resetAt * 1000).toISOString()}. Try again later or authenticate with a GitHub token.`,
      );
      process.exit(1);
    }

    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }

    console.error("An unexpected error occurred.");
    process.exit(1);
  }
}
