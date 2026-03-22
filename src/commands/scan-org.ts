import { resolveToken } from "../github/auth.js";
import { GitHubClient, RateLimitError } from "../github/client.js";
import {
  fetchOrgRepos,
  fetchIssues,
  fetchPulls,
} from "../github/fetchers.js";
import { detectRejectedDemand, detectWorkarounds } from "../analysis/signals.js";
import { clusterIssues } from "../analysis/cluster.js";
import type { Cluster } from "../analysis/cluster.js";
import { scoreClusters } from "../analysis/scorer.js";
import { aiScoreClusters } from "../analysis/ai-scorer.js";
import { formatScanResult, formatAIScanResult } from "../output/formatters.js";
import type { OutputOptions } from "../output/formatters.js";
import type { RepoMeta } from "../github/types.js";
import { type ScanOptions, mergeClustersAcrossRepos } from "./scan.js";

const MAX_ORG_REPOS = 10;

export async function runOrgScan(
  org: string,
  opts: ScanOptions,
): Promise<void> {
  try {
    // 1. Resolve auth token
    const token = await resolveToken();

    // 2. Create client
    const client = new GitHubClient(token);

    // 3. Fetch org repos filtered by min-stars
    process.stderr.write(`Fetching repos for org "${org}"...\n`);
    const orgRepos = await fetchOrgRepos(client, org, opts.minStars);

    // 4. Take top 10 repos by stars (already sorted by stars from API)
    const topRepos = orgRepos
      .sort((a, b) => b.stars - a.stars)
      .slice(0, MAX_ORG_REPOS);

    if (topRepos.length === 0) {
      console.error(
        `No repos found for org "${org}" with min-stars ${opts.minStars}.`,
      );
      process.exit(1);
    }

    // 5. For each repo, run the scan pipeline
    const allClusters: Cluster[] = [];
    let maxStars = 0;

    for (let i = 0; i < topRepos.length; i++) {
      const repo = topRepos[i];
      const fullName = repo.fullName;
      process.stderr.write(
        `Scanning ${i + 1}/${topRepos.length}: ${fullName}...\n`,
      );

      if (repo.stars > maxStars) {
        maxStars = repo.stars;
      }

      // Fetch issues
      const issues = await fetchIssues(client, fullName, {
        limit: opts.limit,
        period: opts.period,
      });

      // Fetch closed PRs
      const pulls = await fetchPulls(client, fullName, {
        state: "closed",
        limit: 50,
      });

      // Detect signals
      detectRejectedDemand(pulls);
      detectWorkarounds(issues);

      // Cluster issues for this repo
      const clusters = clusterIssues(issues);
      allClusters.push(...clusters);
    }

    // 6. Merge clusters across repos
    const mergedClusters = mergeClustersAcrossRepos(allClusters);

    // 7. Score merged clusters using synthetic RepoMeta (stars = max stars)
    const syntheticMeta: RepoMeta = {
      owner: org,
      repo: org,
      fullName: org,
      stars: maxStars,
      pushedAt: new Date().toISOString(),
      topics: [],
      language: null,
      description: `Aggregated scan for org ${org}`,
    };

    const scored = scoreClusters(mergedClusters, syntheticMeta, "cross");

    // 8. Filter by minReactions
    const filtered = scored.filter(
      (c) => c.totalReactions >= opts.minReactions,
    );

    // 9. AI scoring or heuristic output
    if (opts.aiScore) {
      process.stderr.write("Running AI scoring via Claude Code CLI...\n");
      const toScore = opts.top > 0 ? filtered.slice(0, opts.top) : filtered;
      const aiScored = await aiScoreClusters(toScore, syntheticMeta, {
        verbose: opts.verbose,
      });
      const format = opts.output as OutputOptions["format"];
      const result = formatAIScanResult(aiScored, { format });
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
