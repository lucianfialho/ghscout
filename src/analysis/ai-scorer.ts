import { execSync } from "node:child_process";
import type { ScoredCluster } from "./scorer.js";
import type { RepoMeta } from "../github/types.js";

export interface AIScoredCluster extends ScoredCluster {
  aiScore: number;
  verdict: "BUILD" | "SKIP" | "WATCH";
  rationale: string;
}

interface AIResponse {
  score: number;
  verdict: "BUILD" | "SKIP" | "WATCH";
  rationale: string;
}

/**
 * Check if the claude CLI is available.
 */
export function isClaudeAvailable(): boolean {
  try {
    execSync("claude --version", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the scoring prompt for a cluster.
 */
export function buildPrompt(cluster: ScoredCluster, repoMeta: RepoMeta): string {
  const topIssues = cluster.issues
    .slice()
    .sort((a, b) => b.reactions.total - a.reactions.total)
    .slice(0, 5)
    .map((i) => {
      const ageDays = Math.floor(
        (Date.now() - new Date(i.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      return `- [${i.reactions.total} 👍] ${i.title} (${ageDays}d old)`;
    })
    .join("\n");

  const labels = cluster.labels.length > 0 ? cluster.labels.join(", ") : "none";

  return `You are evaluating a product opportunity found by analyzing GitHub issues.

Cluster: "${cluster.name}"
Repository: ${repoMeta.fullName} (${repoMeta.stars.toLocaleString()} stars)
Issues: ${cluster.issueCount} open issues
Total reactions: ${cluster.totalReactions} 👍
Labels: ${labels}
Heuristic score: ${cluster.score}/100

Top issues in this cluster:
${topIssues}

Score this opportunity on a scale of 0-10 based on these criteria:
1. Product viability: Could someone build a standalone tool, extension, or service for this?
2. Market demand: Is this pain widespread beyond just this repo?
3. Solution gap: Do adequate solutions already exist, or are people stuck?
4. Indie feasibility: Could one developer build an MVP in 2-4 weeks?

Respond ONLY with valid JSON, no markdown, no explanation outside the JSON:
{"score": <0-10>, "verdict": "<BUILD|SKIP|WATCH>", "rationale": "<1-2 sentences explaining your assessment>"}`;
}

/**
 * Call claude CLI to score a single cluster.
 */
export function callClaude(prompt: string, verbose: boolean): AIResponse | null {
  try {
    if (verbose) {
      process.stderr.write("  Calling Claude for AI scoring...\n");
    }

    // Escape the prompt for shell safety
    const escaped = prompt.replace(/'/g, "'\\''");
    const result = execSync(
      `echo '${escaped}' | claude --print --output-format text`,
      {
        encoding: "utf-8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    // Extract JSON from response (claude might add extra text)
    const jsonMatch = result.match(/\{[\s\S]*?"score"[\s\S]*?"verdict"[\s\S]*?"rationale"[\s\S]*?\}/);
    if (!jsonMatch) {
      if (verbose) {
        process.stderr.write(`  Warning: Could not parse AI response\n`);
      }
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as AIResponse;

    // Validate
    if (
      typeof parsed.score !== "number" ||
      parsed.score < 0 ||
      parsed.score > 10 ||
      !["BUILD", "SKIP", "WATCH"].includes(parsed.verdict) ||
      typeof parsed.rationale !== "string"
    ) {
      if (verbose) {
        process.stderr.write(`  Warning: Invalid AI response format\n`);
      }
      return null;
    }

    return parsed;
  } catch (err) {
    if (verbose) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  Warning: Claude call failed (${msg})\n`);
    }
    return null;
  }
}

/**
 * Score clusters using AI via the user's Claude Code CLI.
 * Falls back to heuristic score if claude is not available or call fails.
 */
export async function aiScoreClusters(
  clusters: ScoredCluster[],
  repoMeta: RepoMeta,
  opts: { verbose: boolean; minHeuristicScore?: number },
): Promise<AIScoredCluster[]> {
  if (!isClaudeAvailable()) {
    process.stderr.write(
      "Warning: claude CLI not found. Install Claude Code to use --ai-score.\n" +
        "Falling back to heuristic scoring.\n",
    );
    return clusters.map(fallback);
  }

  const minScore = opts.minHeuristicScore ?? 30;
  const results: AIScoredCluster[] = [];

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];

    // Skip low-scoring clusters and "other" bucket
    if (cluster.score < minScore || cluster.name === "other") {
      results.push(fallback(cluster));
      continue;
    }

    process.stderr.write(
      `AI scoring ${i + 1}/${clusters.length}: "${cluster.name}"...\n`,
    );

    const prompt = buildPrompt(cluster, repoMeta);
    const response = callClaude(prompt, opts.verbose);

    if (response) {
      results.push({
        ...cluster,
        aiScore: response.score,
        verdict: response.verdict,
        rationale: response.rationale,
      });
    } else {
      results.push(fallback(cluster));
    }
  }

  // Sort by AI score descending (fallbacks use heuristic/10)
  return results.sort((a, b) => b.aiScore - a.aiScore);
}

function fallback(cluster: ScoredCluster): AIScoredCluster {
  return {
    ...cluster,
    aiScore: Math.round(cluster.score / 10),
    verdict: cluster.score >= 70 ? "WATCH" : "SKIP",
    rationale: "Heuristic score (AI scoring skipped)",
  };
}
