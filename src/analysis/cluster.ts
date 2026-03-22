import type { Issue } from "../github/types.js";
import { tokenizeTitle, extractBigrams } from "./tokenizer.js";

export interface Cluster {
  name: string;
  issues: Issue[];
  issueCount: number;
  totalReactions: number;
  labels: string[];
}

const GENERIC_LABELS = new Set([
  "bug",
  "feature",
  "enhancement",
  "question",
  "help wanted",
  "good first issue",
]);

/**
 * Cluster issues by shared title tokens (bigrams preferred) with label overlap
 * as a secondary signal.
 */
export function clusterIssues(issues: Issue[]): Cluster[] {
  if (issues.length === 0) return [];

  // Step 1: Tokenize all issues and extract bigrams
  const issueTokens = issues.map((issue) => {
    const tokens = tokenizeTitle(issue.title);
    const bigrams = extractBigrams(tokens);
    return { issue, tokens, bigrams };
  });

  // Step 2: Count frequency of each bigram and unigram across ALL issues
  const bigramFreq = new Map<string, number>();
  const unigramFreq = new Map<string, number>();

  for (const { tokens, bigrams } of issueTokens) {
    // Count each bigram once per issue (deduplicate within a single issue)
    const seenBigrams = new Set<string>();
    for (const bigram of bigrams) {
      if (!seenBigrams.has(bigram)) {
        seenBigrams.add(bigram);
        bigramFreq.set(bigram, (bigramFreq.get(bigram) ?? 0) + 1);
      }
    }

    const seenUnigrams = new Set<string>();
    for (const token of tokens) {
      if (!seenUnigrams.has(token)) {
        seenUnigrams.add(token);
        unigramFreq.set(token, (unigramFreq.get(token) ?? 0) + 1);
      }
    }
  }

  // Step 3 & 6: For each issue, find its "top token" considering label overlap
  // Build label-based affinity: map non-generic labels to issue indices
  const labelToIssues = new Map<string, Set<number>>();
  for (let i = 0; i < issues.length; i++) {
    for (const label of issues[i].labels) {
      const lower = label.toLowerCase();
      if (!GENERIC_LABELS.has(lower)) {
        if (!labelToIssues.has(lower)) {
          labelToIssues.set(lower, new Set());
        }
        labelToIssues.get(lower)!.add(i);
      }
    }
  }

  // For each issue, compute the best token (bigram preferred)
  const issueTopToken: string[] = [];

  for (const { tokens, bigrams } of issueTokens) {
    let bestToken = "";
    let bestScore = -1;
    let bestIsBigram = false;

    // Check bigrams first
    for (const bigram of bigrams) {
      const freq = bigramFreq.get(bigram) ?? 0;
      if (freq > bestScore || (freq === bestScore && !bestIsBigram)) {
        bestScore = freq;
        bestToken = bigram;
        bestIsBigram = true;
      }
    }

    // Check unigrams — only prefer unigram if its frequency is notably higher
    for (const token of tokens) {
      const freq = unigramFreq.get(token) ?? 0;
      // Prefer bigrams when frequency is similar (bigram needs freq * 1.5 < unigram freq to lose)
      if (bestIsBigram) {
        if (freq > bestScore * 1.5) {
          bestScore = freq;
          bestToken = token;
          bestIsBigram = false;
        }
      } else {
        if (freq > bestScore) {
          bestScore = freq;
          bestToken = token;
          bestIsBigram = false;
        }
      }
    }

    issueTopToken.push(bestToken || "other");
  }

  // Step 6 (continued): Boost grouping via shared non-generic labels
  // If two issues share a non-generic label and one of them has a top token with freq < 2,
  // try to reassign it to match the other issue's top token
  for (const [, issueIndices] of labelToIssues) {
    if (issueIndices.size < 2) continue;
    const indices = Array.from(issueIndices);

    // Find the most common top token among issues sharing this label
    const tokenCounts = new Map<string, number>();
    for (const idx of indices) {
      const token = issueTopToken[idx];
      if (token !== "other") {
        tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
      }
    }

    if (tokenCounts.size === 0) continue;

    let dominantToken = "";
    let dominantCount = 0;
    for (const [token, count] of tokenCounts) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantToken = token;
      }
    }

    // Reassign issues with weak tokens to the dominant one in this label group
    if (dominantCount >= 2) {
      for (const idx of indices) {
        const currentToken = issueTopToken[idx];
        if (currentToken === "other") {
          issueTopToken[idx] = dominantToken;
          continue;
        }
        // Check if current token is weak (only appears once in global freq)
        const currentFreq = bigramFreq.get(currentToken) ?? unigramFreq.get(currentToken) ?? 0;
        if (currentFreq < 2 && currentToken !== dominantToken) {
          issueTopToken[idx] = dominantToken;
        }
      }
    }
  }

  // Step 4: Group issues by their top token
  const groups = new Map<string, Issue[]>();
  for (let i = 0; i < issues.length; i++) {
    const token = issueTopToken[i];
    if (!groups.has(token)) {
      groups.set(token, []);
    }
    groups.get(token)!.push(issues[i]);
  }

  // Step 5: Merge small clusters (<2 issues) into "other"
  const clusters: Cluster[] = [];
  const otherIssues: Issue[] = [];

  for (const [name, groupIssues] of groups) {
    if (groupIssues.length < 2) {
      otherIssues.push(...groupIssues);
    } else {
      clusters.push(buildCluster(name, groupIssues));
    }
  }

  if (otherIssues.length > 0) {
    clusters.push(buildCluster("other", otherIssues));
  }

  // Step 9: Sort by issueCount descending, then totalReactions descending
  clusters.sort((a, b) => {
    if (b.issueCount !== a.issueCount) return b.issueCount - a.issueCount;
    return b.totalReactions - a.totalReactions;
  });

  return clusters;
}

function buildCluster(name: string, issues: Issue[]): Cluster {
  // Step 7: Calculate totalReactions
  const totalReactions = issues.reduce(
    (sum, issue) => sum + issue.reactions.total,
    0,
  );

  // Step 8: Collect common labels
  const labelCounts = new Map<string, number>();
  for (const issue of issues) {
    for (const label of issue.labels) {
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
  }

  // Labels that appear in at least half the issues in the cluster
  const threshold = Math.ceil(issues.length / 2);
  const labels = Array.from(labelCounts.entries())
    .filter(([, count]) => count >= threshold)
    .map(([label]) => label)
    .sort();

  return {
    name,
    issues,
    issueCount: issues.length,
    totalReactions,
    labels,
  };
}
