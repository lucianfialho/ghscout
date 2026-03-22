import type { Pull, Issue } from "../github/types.js";

export interface RejectedPR {
  number: number;
  title: string;
  htmlUrl: string;
  reactions: { thumbsUp: number; thumbsDown: number; total: number };
  user: string;
  createdAt: string;
}

export interface WorkaroundIssue {
  number: number;
  title: string;
  htmlUrl: string;
  signals: string[];
}

/**
 * Finds closed PRs that were not merged but had significant positive reactions,
 * indicating demand that was rejected by maintainers.
 */
export function detectRejectedDemand(pulls: Pull[]): RejectedPR[] {
  return pulls
    .filter((pr) => !pr.merged && pr.reactions.thumbsUp >= 3)
    .sort((a, b) => b.reactions.thumbsUp - a.reactions.thumbsUp)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      htmlUrl: pr.htmlUrl,
      reactions: pr.reactions,
      user: pr.user,
      createdAt: pr.createdAt,
    }));
}

/**
 * Detects issues where users posted workarounds — code blocks or
 * references to npm/yarn/pnpm packages as alternative solutions.
 */
export function detectWorkarounds(issues: Issue[]): WorkaroundIssue[] {
  const results: WorkaroundIssue[] = [];

  for (const issue of issues) {
    const body = issue.body;
    if (!body) continue;

    const signals: string[] = [];

    // Detect code blocks
    if (/```[\s\S]*?```/.test(body)) {
      signals.push("code block");
    }

    // Detect npm install references
    const npmMatches = body.matchAll(/npm i(?:nstall)?\s+([\w@/-]+)/g);
    for (const match of npmMatches) {
      signals.push(`npm package: ${match[1]}`);
    }

    // Detect yarn add references
    const yarnMatches = body.matchAll(/yarn add\s+([\w@/-]+)/g);
    for (const match of yarnMatches) {
      signals.push(`yarn package: ${match[1]}`);
    }

    // Detect pnpm add references
    const pnpmMatches = body.matchAll(/pnpm add\s+([\w@/-]+)/g);
    for (const match of pnpmMatches) {
      signals.push(`pnpm package: ${match[1]}`);
    }

    if (signals.length > 0) {
      results.push({
        number: issue.number,
        title: issue.title,
        htmlUrl: issue.htmlUrl,
        signals,
      });
    }
  }

  return results;
}
