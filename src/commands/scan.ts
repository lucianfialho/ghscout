import { resolveToken } from "../github/auth.js";
import { GitHubClient, RateLimitError } from "../github/client.js";
import { fetchRepoMeta, fetchIssues, fetchPulls, searchReposByTopic } from "../github/fetchers.js";
import { detectRejectedDemand, detectWorkarounds } from "../analysis/signals.js";
import { clusterIssues } from "../analysis/cluster.js";
import type { Cluster } from "../analysis/cluster.js";
import { scoreClusters } from "../analysis/scorer.js";
import { aiScoreClusters } from "../analysis/ai-scorer.js";
import { formatScanResult, formatAIScanResult } from "../output/formatters.js";
import type { OutputOptions } from "../output/formatters.js";
import type { RepoMeta } from "../github/types.js";

export interface ScanOptions {
  output: string;
  limit: number;
  period: string;
  minStars: number;
  verbose: boolean;
  noCache: boolean;
  top: number;
  minReactions: number;
  aiScore?: boolean;
}

function verbose(msg: string, enabled: boolean): void {
  if (enabled) {
    process.stderr.write(msg + "\n");
  }
}

export async function runScan(repo: string, opts: ScanOptions): Promise<void> {
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
    // 2. Resolve auth token
    const token = await resolveToken();

    // 3. Create client
    const client = new GitHubClient(token);

    // 4-5. Fetch repo metadata
    verbose("Fetching repo metadata...", opts.verbose);
    const repoMeta = await fetchRepoMeta(client, repo);

    // Show repo activity status
    if (repoMeta.pushedAt) {
      const daysSincePush = Math.floor((Date.now() - new Date(repoMeta.pushedAt).getTime()) / (1000 * 60 * 60 * 24));
      const status = daysSincePush < 30 ? "active" : daysSincePush < 180 ? "stale" : "inactive";
      process.stderr.write(`→ ${repoMeta.fullName} (${repoMeta.stars.toLocaleString()} stars, last push: ${daysSincePush}d ago — ${status})\n`);
    }

    // 6-7. Fetch issues
    const periodInfo = opts.period ? `, period: ${opts.period}` : ", all open";
    verbose(`Fetching issues (limit: ${opts.limit}${periodInfo})...`, opts.verbose);
    const issues = await fetchIssues(client, repo, {
      limit: opts.limit,
      period: opts.period || undefined,
    });

    // 8-9. Fetch closed PRs
    verbose("Fetching closed PRs...", opts.verbose);
    const pulls = await fetchPulls(client, repo, { state: "closed", limit: 50 });

    // 10. Detect signals
    const rejectedPRs = detectRejectedDemand(pulls);
    const _workarounds = detectWorkarounds(issues);

    // 11-12. Cluster issues
    verbose(`Clustering ${issues.length} issues...`, opts.verbose);
    const clusters = clusterIssues(issues);

    // 13. Score clusters
    const scored = scoreClusters(clusters, repoMeta, "single");

    // 14. Filter by minReactions
    const filtered = scored.filter(
      (c) => c.totalReactions >= opts.minReactions,
    );

    // 15. AI scoring (optional)
    if (opts.aiScore) {
      verbose("Running AI scoring via Claude Code CLI...", opts.verbose);
      const aiScored = await aiScoreClusters(filtered, repoMeta, {
        verbose: opts.verbose,
      });
      const format = opts.output as OutputOptions["format"];
      const result = formatAIScanResult(aiScored, { format, top: opts.top });
      console.log(result);
    } else {
      // 16. Format output (heuristic)
      const format = opts.output as OutputOptions["format"];
      const result = formatScanResult(filtered, { format, top: opts.top });
      console.log(result);
    }

    // 17. Print rejected PRs section
    if (rejectedPRs.length > 0) {
      console.log("");
      console.log("Rejected PRs with demand:");
      for (const pr of rejectedPRs) {
        console.log(
          `  - ${pr.title} (${pr.htmlUrl}) [+${pr.reactions.thumbsUp} reactions]`,
        );
      }
    }
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      console.error(
        `Rate limit exhausted. Resets at ${new Date(error.resetAt * 1000).toISOString()}. Try again later or authenticate with a GitHub token.`,
      );
      process.exit(1);
    }

    if (error instanceof Error) {
      const msg = error.message;

      // Repo not found (404)
      if (msg.includes("404")) {
        console.error(
          `Repository "${repo}" not found. Check the owner/repo name and try again.`,
        );
        process.exit(1);
      }

      // Generic network / API error
      console.error(`Error: ${msg}`);
      process.exit(1);
    }

    console.error("An unexpected error occurred.");
    process.exit(1);
  }
}

export interface TopicScanOptions {
  topic: string;
  lang?: string;
  output: string;
  limit: number;
  period: string;
  minStars: number;
  verbose: boolean;
  noCache: boolean;
  top: number;
  minReactions: number;
  aiScore?: boolean;
}

/**
 * Merge clusters from multiple repos. Clusters with the same name are merged:
 * their issues are combined, counts and reactions are summed, and labels are unioned.
 */
export function mergeClustersAcrossRepos(
  allClusters: Cluster[],
): Cluster[] {
  const merged = new Map<string, Cluster>();

  for (const cluster of allClusters) {
    const existing = merged.get(cluster.name);
    if (existing) {
      existing.issues = [...existing.issues, ...cluster.issues];
      existing.issueCount += cluster.issueCount;
      existing.totalReactions += cluster.totalReactions;
      // Union labels
      const labelSet = new Set([...existing.labels, ...cluster.labels]);
      existing.labels = Array.from(labelSet).sort();
    } else {
      merged.set(cluster.name, {
        ...cluster,
        issues: [...cluster.issues],
        labels: [...cluster.labels],
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (b.issueCount !== a.issueCount) return b.issueCount - a.issueCount;
    return b.totalReactions - a.totalReactions;
  });
}

const MAX_REPOS = 10;

export async function runTopicScan(opts: TopicScanOptions): Promise<void> {
  try {
    // 1. Resolve auth token
    const token = await resolveToken();
    const client = new GitHubClient(token);

    // 2. Search repos by topic
    verbose(`Searching repos for topic "${opts.topic}"...`, opts.verbose);
    const repos = await searchReposByTopic(
      client,
      opts.topic,
      opts.lang,
      opts.minStars,
    );

    const topRepos = repos.slice(0, MAX_REPOS);

    if (topRepos.length === 0) {
      console.error(`No repos found for topic "${opts.topic}".`);
      process.exit(1);
    }

    // 3. Run pipeline per repo, collect clusters
    const allClusters: Cluster[] = [];
    // Use the first repo's meta as a representative for scoring (highest stars)
    let bestRepoMeta: RepoMeta = topRepos[0];

    for (let i = 0; i < topRepos.length; i++) {
      const repo = topRepos[i];
      const fullName = repo.fullName;
      process.stderr.write(`Scanning ${i + 1}/${topRepos.length}: ${fullName}...\n`);

      if (repo.stars > bestRepoMeta.stars) {
        bestRepoMeta = repo;
      }

      try {
        const issues = await fetchIssues(client, fullName, {
          limit: opts.limit,
          period: opts.period,
        });

        const pulls = await fetchPulls(client, fullName, {
          state: "closed",
          limit: 50,
        });

        detectRejectedDemand(pulls);
        detectWorkarounds(issues);

        const clusters = clusterIssues(issues);
        allClusters.push(...clusters);
      } catch (err: unknown) {
        // Skip repos that fail (e.g. 404, permissions) but warn
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`  Warning: skipped ${fullName} (${msg})\n`);
      }
    }

    // 4. Merge clusters across repos
    const merged = mergeClustersAcrossRepos(allClusters);

    // 5. Score merged clusters
    const scored = scoreClusters(merged, bestRepoMeta, "cross");

    // 6. Filter by minReactions
    const filtered = scored.filter(
      (c) => c.totalReactions >= opts.minReactions,
    );

    // 7. AI scoring or heuristic output
    if (opts.aiScore) {
      verbose("Running AI scoring via Claude Code CLI...", opts.verbose);
      const aiScored = await aiScoreClusters(filtered, bestRepoMeta, {
        verbose: opts.verbose,
      });
      const format = opts.output as OutputOptions["format"];
      const result = formatAIScanResult(aiScored, { format, top: opts.top });
      console.log(result);
    } else {
      const format = opts.output as OutputOptions["format"];
      const result = formatScanResult(filtered, { format, top: opts.top });
      console.log(result);
    }
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
