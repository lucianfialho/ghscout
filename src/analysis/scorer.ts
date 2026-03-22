import type { Cluster } from "./cluster.js";
import type { RepoMeta } from "../github/types.js";

export interface ScoredCluster extends Cluster {
  score: number;
  breakdown: {
    demand: number;
    frequency: number;
    frustration: number;
    marketSize: number;
    gap: number;
  };
}

const FRUSTRATION_KEYWORDS = [
  "broken",
  "crash",
  "fail",
  "stuck",
  "slow",
  "cannot",
  "doesn't work",
  "not working",
  "impossible",
];

/** Linearly normalize a value to 0-100 given min/max from the dataset. */
function relNormalize(value: number, min: number, max: number): number {
  if (max === min) return 50; // all same = middle
  return ((value - min) / (max - min)) * 100;
}

/** Count frustration keywords across all issue titles in a cluster. */
function countFrustrationKeywords(cluster: Cluster): number {
  let count = 0;
  for (const issue of cluster.issues) {
    const lower = issue.title.toLowerCase();
    for (const keyword of FRUSTRATION_KEYWORDS) {
      if (lower.includes(keyword)) {
        count++;
      }
    }
  }
  return count;
}

/** Calculate average age of issues in days. */
function avgAgeDays(cluster: Cluster): number {
  if (cluster.issues.length === 0) return 0;
  const now = Date.now();
  let totalDays = 0;
  for (const issue of cluster.issues) {
    const created = new Date(issue.createdAt).getTime();
    totalDays += (now - created) / (1000 * 60 * 60 * 24);
  }
  return totalDays / cluster.issues.length;
}

/** Raw demand: total thumbsUp reactions. */
function rawDemand(cluster: Cluster): number {
  return cluster.issues.reduce(
    (sum, issue) => sum + issue.reactions.thumbsUp,
    0,
  );
}

/** Raw frequency: issue count. */
function rawFrequency(cluster: Cluster): number {
  return cluster.issueCount;
}

/** Raw frustration: thumbsDown + keywords + age bonus. */
function rawFrustration(cluster: Cluster): number {
  const totalThumbsDown = cluster.issues.reduce(
    (sum, issue) => sum + issue.reactions.thumbsDown,
    0,
  );
  const keywordCount = countFrustrationKeywords(cluster);
  let raw = totalThumbsDown + keywordCount;

  if (avgAgeDays(cluster) > 90) {
    raw += 30;
  }

  return raw;
}

/** Gap score (0-100): percentage of open issues. Not relative — absolute. */
function scoreGap(cluster: Cluster): number {
  if (cluster.issues.length === 0) return 0;
  const openCount = cluster.issues.filter(
    (issue) => issue.state === "open",
  ).length;
  return (openCount / cluster.issues.length) * 100;
}

/** Market size score (0-100): repo stars, absolute normalization. */
function scoreMarketSize(repoMeta: RepoMeta): number {
  if (repoMeta.stars >= 50000) return 100;
  if (repoMeta.stars <= 0) return 0;
  return (repoMeta.stars / 50000) * 100;
}

/**
 * Score a single cluster. Used only when scoring one cluster in isolation.
 * For proper relative scoring, use scoreClusters().
 */
export function scoreCluster(
  cluster: Cluster,
  repoMeta: RepoMeta,
): ScoredCluster {
  // Fallback absolute normalization for single-cluster scoring
  const demand = Math.min(100, (rawDemand(cluster) / 50) * 100);
  const frequency = Math.min(100, ((rawFrequency(cluster) - 1) / 19) * 100);
  const frustration = Math.min(100, (rawFrustration(cluster) / 50) * 100);
  const marketSize = scoreMarketSize(repoMeta);
  const gap = scoreGap(cluster);

  let score = Math.round(
    demand * 0.3 +
      frequency * 0.25 +
      frustration * 0.15 +
      marketSize * 0.15 +
      gap * 0.15,
  );

  if (cluster.name === "other") {
    score = Math.round(score * 0.3);
  }

  return {
    ...cluster,
    score,
    breakdown: {
      demand: Math.round(demand),
      frequency: Math.round(frequency),
      frustration: Math.round(frustration),
      marketSize: Math.round(marketSize),
      gap: Math.round(gap),
    },
  };
}

/**
 * Score all clusters with relative normalization.
 * Demand, frequency, and frustration are normalized against the min/max
 * of the current dataset so they always spread 0-100.
 */
export function scoreClusters(
  clusters: Cluster[],
  repoMeta: RepoMeta,
): ScoredCluster[] {
  if (clusters.length === 0) return [];

  // Filter out "other" for raw calculation, score it separately
  const real = clusters.filter((c) => c.name !== "other");
  const other = clusters.filter((c) => c.name === "other");

  if (real.length === 0) {
    // Only "other" clusters — use absolute scoring
    return other.map((c) => scoreCluster(c, repoMeta));
  }

  // Step 1: Calculate raw values for each cluster
  const raws = real.map((c) => ({
    cluster: c,
    demand: rawDemand(c),
    frequency: rawFrequency(c),
    frustration: rawFrustration(c),
    gap: scoreGap(c),
  }));

  // Step 2: Find min/max for relative normalization
  const demandValues = raws.map((r) => r.demand);
  const freqValues = raws.map((r) => r.frequency);
  const frustValues = raws.map((r) => r.frustration);

  const demandMin = Math.min(...demandValues);
  const demandMax = Math.max(...demandValues);
  const freqMin = Math.min(...freqValues);
  const freqMax = Math.max(...freqValues);
  const frustMin = Math.min(...frustValues);
  const frustMax = Math.max(...frustValues);

  const marketSize = scoreMarketSize(repoMeta);

  // Step 3: Score each cluster with relative normalization
  const scored: ScoredCluster[] = raws.map((r) => {
    const demand = relNormalize(r.demand, demandMin, demandMax);
    const frequency = relNormalize(r.frequency, freqMin, freqMax);
    const frustration = relNormalize(r.frustration, frustMin, frustMax);
    const gap = r.gap;

    const score = Math.round(
      demand * 0.3 +
        frequency * 0.25 +
        frustration * 0.15 +
        marketSize * 0.15 +
        gap * 0.15,
    );

    return {
      ...r.cluster,
      score,
      breakdown: {
        demand: Math.round(demand),
        frequency: Math.round(frequency),
        frustration: Math.round(frustration),
        marketSize: Math.round(marketSize),
        gap: Math.round(gap),
      },
    };
  });

  // Score "other" clusters with penalty
  for (const c of other) {
    const sc = scoreCluster(c, repoMeta);
    sc.score = Math.round(sc.score * 0.3);
    scored.push(sc);
  }

  return scored.sort((a, b) => b.score - a.score);
}
