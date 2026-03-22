import { GitHubClient } from "./client.js";
import type { RepoMeta, Issue, Pull, FetchOptions } from "./types.js";

const BASE = "https://api.github.com";

/**
 * Parse a period string like "30d" into an ISO 8601 date string
 * representing that many days before now.
 */
export function parsePeriod(period: string): string {
  const match = period.match(/^(\d+)d$/);
  if (!match) {
    throw new Error(`Invalid period format: "${period}". Expected format like "30d".`);
  }
  const days = parseInt(match[1], 10);
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function splitFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repo format: "${fullName}". Expected "owner/repo".`);
  }
  return { owner, repo };
}

export async function fetchRepoMeta(
  client: GitHubClient,
  fullName: string,
): Promise<RepoMeta> {
  const { owner, repo } = splitFullName(fullName);
  const data = await client.get<Record<string, unknown>>(
    `${BASE}/repos/${owner}/${repo}`,
  );

  return {
    owner,
    repo,
    fullName: (data.full_name as string) ?? fullName,
    stars: (data.stargazers_count as number) ?? 0,
    pushedAt: (data.pushed_at as string) ?? "",
    topics: (data.topics as string[]) ?? [],
    language: (data.language as string | null) ?? null,
    description: (data.description as string) ?? "",
  };
}

export async function fetchIssues(
  client: GitHubClient,
  fullName: string,
  opts: FetchOptions = {},
): Promise<Issue[]> {
  const { owner, repo } = splitFullName(fullName);
  const limit = opts.limit ?? 200;
  const perPage = Math.min(limit, 100);
  const maxPages = Math.ceil(limit / perPage);

  const params: Record<string, string> = {
    state: opts.state ?? "open",
    per_page: String(perPage),
    sort: "reactions-+1",
    direction: "desc",
  };

  // Only apply period filter if explicitly requested
  if (opts.period) {
    params.since = parsePeriod(opts.period);
  }

  const data = await client.getPaginated<Record<string, unknown>>(
    `${BASE}/repos/${owner}/${repo}/issues`,
    params,
    maxPages,
  );

  // Filter out pull requests (GitHub issues API includes PRs)
  const issues = data.filter(
    (item) => !item.pull_request,
  );

  return issues.slice(0, limit).map(mapIssue);
}

export async function fetchPulls(
  client: GitHubClient,
  fullName: string,
  opts: FetchOptions = {},
): Promise<Pull[]> {
  const { owner, repo } = splitFullName(fullName);
  const limit = opts.limit ?? 100;
  const perPage = Math.min(limit, 100);

  const params: Record<string, string> = {
    state: opts.state ?? "closed",
    per_page: String(perPage),
    sort: "created",
    direction: "desc",
  };

  const data = await client.get<Record<string, unknown>[]>(
    `${BASE}/repos/${owner}/${repo}/pulls`,
    params,
  );

  return data.slice(0, limit).map(mapPull);
}

export async function fetchOrgRepos(
  client: GitHubClient,
  org: string,
  minStars: number = 0,
): Promise<RepoMeta[]> {
  const data = await client.get<Record<string, unknown>[]>(
    `${BASE}/orgs/${org}/repos`,
    { sort: "stars", per_page: "100", direction: "desc" },
  );

  return data
    .filter((r) => ((r.stargazers_count as number) ?? 0) >= minStars)
    .map(mapRepoMeta);
}

export async function searchReposByTopic(
  client: GitHubClient,
  topic: string,
  lang?: string,
  minStars?: number,
): Promise<RepoMeta[]> {
  let q = `topic:${topic}`;
  if (lang) {
    q += ` language:${lang}`;
  }
  if (minStars !== undefined && minStars > 0) {
    q += ` stars:>=${minStars}`;
  }

  const data = await client.get<{ items: Record<string, unknown>[] }>(
    `${BASE}/search/repositories`,
    { q, sort: "stars" },
  );

  return (data.items ?? []).map(mapRepoMeta);
}

// --- mapping helpers ---

function mapRepoMeta(data: Record<string, unknown>): RepoMeta {
  const fullName = data.full_name as string;
  const [owner, repo] = fullName.split("/");
  return {
    owner,
    repo,
    fullName,
    stars: (data.stargazers_count as number) ?? 0,
    pushedAt: (data.pushed_at as string) ?? "",
    topics: (data.topics as string[]) ?? [],
    language: (data.language as string | null) ?? null,
    description: (data.description as string) ?? "",
  };
}

function mapIssue(data: Record<string, unknown>): Issue {
  const reactions = data.reactions as Record<string, number> | undefined;
  const labels = (data.labels as Array<{ name: string } | string>) ?? [];
  const user = data.user as Record<string, unknown> | undefined;

  return {
    number: data.number as number,
    title: data.title as string,
    body: (data.body as string) ?? "",
    labels: labels.map((l) => (typeof l === "string" ? l : l.name)),
    reactions: {
      thumbsUp: reactions?.["+1"] ?? 0,
      thumbsDown: reactions?.["-1"] ?? 0,
      total: reactions?.total_count ?? 0,
    },
    commentsCount: (data.comments as number) ?? 0,
    createdAt: data.created_at as string,
    htmlUrl: data.html_url as string,
    user: (user?.login as string) ?? "",
    state: data.state as string,
  };
}

function mapPull(data: Record<string, unknown>): Pull {
  const reactions = data.reactions as Record<string, number> | undefined;
  const user = data.user as Record<string, unknown> | undefined;
  const mergedAt = (data.merged_at as string | null) ?? null;

  return {
    number: data.number as number,
    title: data.title as string,
    merged: mergedAt !== null,
    mergedAt,
    reactions: {
      thumbsUp: reactions?.["+1"] ?? 0,
      thumbsDown: reactions?.["-1"] ?? 0,
      total: reactions?.total_count ?? 0,
    },
    htmlUrl: data.html_url as string,
    user: (user?.login as string) ?? "",
    createdAt: data.created_at as string,
  };
}
