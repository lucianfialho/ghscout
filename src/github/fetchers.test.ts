import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchRepoMeta,
  fetchIssues,
  fetchPulls,
  fetchOrgRepos,
  searchReposByTopic,
  parsePeriod,
} from "./fetchers.js";
import type { GitHubClient } from "./client.js";

// --- Mock client factory ---

function createMockClient(responses: Record<string, unknown> = {}) {
  const client = {
    get: vi.fn(async (url: string, _params?: Record<string, string>) => {
      for (const [pattern, data] of Object.entries(responses)) {
        if (url.includes(pattern)) {
          return data;
        }
      }
      return {};
    }),
    getPaginated: vi.fn(async (url: string, _params?: Record<string, string>) => {
      for (const [pattern, data] of Object.entries(responses)) {
        if (url.includes(pattern)) {
          return data;
        }
      }
      return [];
    }),
  } as unknown as GitHubClient;
  return client;
}

// --- Fixture data ---

const repoFixture = {
  full_name: "vercel/next.js",
  stargazers_count: 120000,
  pushed_at: "2026-03-20T10:00:00Z",
  topics: ["react", "nextjs", "framework"],
  language: "TypeScript",
  description: "The React Framework",
};

const issueFixtures = [
  {
    number: 101,
    title: "CSS modules broken in dev mode",
    body: "When using CSS modules, hot reload fails.",
    labels: [{ name: "bug" }, { name: "css" }],
    reactions: { "+1": 15, "-1": 2, total_count: 20 },
    comments: 8,
    created_at: "2026-03-10T12:00:00Z",
    html_url: "https://github.com/vercel/next.js/issues/101",
    user: { login: "devuser1" },
    state: "open",
  },
  {
    number: 102,
    title: "Middleware not working with edge runtime",
    body: "Edge middleware throws on cold start.",
    labels: [{ name: "enhancement" }],
    reactions: { "+1": 30, "-1": 0, total_count: 35 },
    comments: 12,
    created_at: "2026-03-05T08:00:00Z",
    html_url: "https://github.com/vercel/next.js/issues/102",
    user: { login: "devuser2" },
    state: "open",
  },
  {
    // This is a pull request included in the issues endpoint — should be filtered out
    number: 200,
    title: "Fix typo in docs",
    body: "",
    labels: [],
    reactions: { "+1": 0, "-1": 0, total_count: 0 },
    comments: 1,
    created_at: "2026-03-15T00:00:00Z",
    html_url: "https://github.com/vercel/next.js/issues/200",
    user: { login: "contributor1" },
    state: "open",
    pull_request: { url: "https://api.github.com/repos/vercel/next.js/pulls/200" },
  },
];

const pullFixtures = [
  {
    number: 301,
    title: "Add streaming SSR support",
    merged_at: "2026-03-12T09:00:00Z",
    reactions: { "+1": 50, "-1": 1, total_count: 55 },
    html_url: "https://github.com/vercel/next.js/pull/301",
    user: { login: "maintainer1" },
    created_at: "2026-03-01T10:00:00Z",
    state: "closed",
  },
  {
    number: 302,
    title: "Alternative routing approach",
    merged_at: null,
    reactions: { "+1": 8, "-1": 3, total_count: 12 },
    html_url: "https://github.com/vercel/next.js/pull/302",
    user: { login: "contributor2" },
    created_at: "2026-02-20T14:00:00Z",
    state: "closed",
  },
];

const orgRepoFixtures = [
  { full_name: "vercel/next.js", stargazers_count: 120000, pushed_at: "2026-03-20T10:00:00Z", topics: ["react"], language: "TypeScript", description: "React framework" },
  { full_name: "vercel/swr", stargazers_count: 30000, pushed_at: "2026-03-18T10:00:00Z", topics: ["react"], language: "TypeScript", description: "SWR" },
  { full_name: "vercel/micro", stargazers_count: 500, pushed_at: "2026-01-01T00:00:00Z", topics: [], language: "JavaScript", description: "Micro" },
];

const searchFixture = {
  items: [
    { full_name: "facebook/react", stargazers_count: 220000, pushed_at: "2026-03-20T10:00:00Z", topics: ["react", "ui"], language: "JavaScript", description: "A JavaScript library" },
    { full_name: "vuejs/vue", stargazers_count: 210000, pushed_at: "2026-03-19T10:00:00Z", topics: ["vue", "ui"], language: "TypeScript", description: "Vue.js" },
  ],
};

// --- Tests ---

describe("parsePeriod", () => {
  it("parses 30d to a date ~30 days ago", () => {
    const result = parsePeriod("30d");
    const parsed = new Date(result);
    const diffMs = Date.now() - parsed.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(29.9);
    expect(diffDays).toBeLessThanOrEqual(30.1);
  });

  it("parses 7d correctly", () => {
    const result = parsePeriod("7d");
    const parsed = new Date(result);
    const diffMs = Date.now() - parsed.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(6.9);
    expect(diffDays).toBeLessThanOrEqual(7.1);
  });

  it("parses 90d correctly", () => {
    const result = parsePeriod("90d");
    const parsed = new Date(result);
    const diffMs = Date.now() - parsed.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(89.9);
    expect(diffDays).toBeLessThanOrEqual(90.1);
  });

  it("throws on invalid period format", () => {
    expect(() => parsePeriod("abc")).toThrow("Invalid period format");
    expect(() => parsePeriod("30")).toThrow("Invalid period format");
    expect(() => parsePeriod("30w")).toThrow("Invalid period format");
  });
});

describe("fetchRepoMeta", () => {
  it("returns structured repo data", async () => {
    const client = createMockClient({ "/repos/vercel/next.js": repoFixture });
    const result = await fetchRepoMeta(client, "vercel/next.js");

    expect(result).toEqual({
      owner: "vercel",
      repo: "next.js",
      fullName: "vercel/next.js",
      stars: 120000,
      pushedAt: "2026-03-20T10:00:00Z",
      topics: ["react", "nextjs", "framework"],
      language: "TypeScript",
      description: "The React Framework",
    });

    expect(client.get).toHaveBeenCalledWith(
      "https://api.github.com/repos/vercel/next.js",
    );
  });

  it("throws on invalid repo format", async () => {
    const client = createMockClient({});
    await expect(fetchRepoMeta(client, "invalid")).rejects.toThrow(
      'Invalid repo format',
    );
  });
});

describe("fetchIssues", () => {
  it("returns issues mapped correctly", async () => {
    const client = createMockClient({ "/repos/vercel/next.js/issues": issueFixtures });
    const result = await fetchIssues(client, "vercel/next.js");

    // Should filter out the pull request (item with pull_request field)
    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      number: 101,
      title: "CSS modules broken in dev mode",
      body: "When using CSS modules, hot reload fails.",
      labels: ["bug", "css"],
      reactions: { thumbsUp: 15, thumbsDown: 2, total: 20 },
      commentsCount: 8,
      createdAt: "2026-03-10T12:00:00Z",
      htmlUrl: "https://github.com/vercel/next.js/issues/101",
      user: "devuser1",
      state: "open",
    });
  });

  it("maps GitHub +1/-1 reactions to thumbsUp/thumbsDown", async () => {
    const client = createMockClient({ "/repos/vercel/next.js/issues": issueFixtures });
    const result = await fetchIssues(client, "vercel/next.js");

    expect(result[0].reactions.thumbsUp).toBe(15);
    expect(result[0].reactions.thumbsDown).toBe(2);
    expect(result[0].reactions.total).toBe(20);
  });

  it("respects limit option", async () => {
    const client = createMockClient({ "/repos/vercel/next.js/issues": issueFixtures });
    const result = await fetchIssues(client, "vercel/next.js", { limit: 1 });

    expect(result).toHaveLength(1);
  });

  it("passes period as since param", async () => {
    const client = createMockClient({ "/repos/vercel/next.js/issues": issueFixtures });
    await fetchIssues(client, "vercel/next.js", { period: "30d" });

    const callArgs = (client.getPaginated as ReturnType<typeof vi.fn>).mock.calls[0];
    const params = callArgs[1] as Record<string, string>;
    expect(params.since).toBeDefined();
    // Verify it's a valid ISO date string
    expect(new Date(params.since).toISOString()).toBe(params.since);
  });

  it("does not pass since param when no period", async () => {
    const client = createMockClient({ "/repos/vercel/next.js/issues": issueFixtures });
    await fetchIssues(client, "vercel/next.js");

    const callArgs = (client.getPaginated as ReturnType<typeof vi.fn>).mock.calls[0];
    const params = callArgs[1] as Record<string, string>;
    expect(params.since).toBeUndefined();
  });

  it("filters out pull requests from issues endpoint", async () => {
    const client = createMockClient({ "/repos/vercel/next.js/issues": issueFixtures });
    const result = await fetchIssues(client, "vercel/next.js");

    const prNumbers = result.map((i) => i.number);
    expect(prNumbers).not.toContain(200);
  });
});

describe("fetchPulls", () => {
  it("returns pulls mapped correctly", async () => {
    const client = createMockClient({ "/repos/vercel/next.js/pulls": pullFixtures });
    const result = await fetchPulls(client, "vercel/next.js");

    expect(result).toHaveLength(2);
  });

  it("correctly distinguishes merged vs rejected PRs", async () => {
    const client = createMockClient({ "/repos/vercel/next.js/pulls": pullFixtures });
    const result = await fetchPulls(client, "vercel/next.js");

    // PR 301 has merged_at set — it was merged
    const merged = result.find((p) => p.number === 301)!;
    expect(merged.merged).toBe(true);
    expect(merged.mergedAt).toBe("2026-03-12T09:00:00Z");

    // PR 302 has merged_at null — it was rejected (closed without merge)
    const rejected = result.find((p) => p.number === 302)!;
    expect(rejected.merged).toBe(false);
    expect(rejected.mergedAt).toBeNull();
  });

  it("maps reactions correctly on PRs", async () => {
    const client = createMockClient({ "/repos/vercel/next.js/pulls": pullFixtures });
    const result = await fetchPulls(client, "vercel/next.js");

    expect(result[0].reactions.thumbsUp).toBe(50);
    expect(result[0].reactions.thumbsDown).toBe(1);
    expect(result[0].reactions.total).toBe(55);
  });

  it("defaults to state=closed", async () => {
    const client = createMockClient({ "/repos/vercel/next.js/pulls": pullFixtures });
    await fetchPulls(client, "vercel/next.js");

    const callArgs = (client.get as ReturnType<typeof vi.fn>).mock.calls[0];
    const params = callArgs[1] as Record<string, string>;
    expect(params.state).toBe("closed");
  });
});

describe("fetchOrgRepos", () => {
  it("returns repos mapped correctly", async () => {
    const client = createMockClient({ "/orgs/vercel/repos": orgRepoFixtures });
    const result = await fetchOrgRepos(client, "vercel");

    expect(result).toHaveLength(3);
    expect(result[0].fullName).toBe("vercel/next.js");
    expect(result[0].stars).toBe(120000);
  });

  it("filters by min stars", async () => {
    const client = createMockClient({ "/orgs/vercel/repos": orgRepoFixtures });
    const result = await fetchOrgRepos(client, "vercel", 1000);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.stars >= 1000)).toBe(true);
  });

  it("returns empty array when no repos meet min stars", async () => {
    const client = createMockClient({ "/orgs/vercel/repos": orgRepoFixtures });
    const result = await fetchOrgRepos(client, "vercel", 999999);

    expect(result).toHaveLength(0);
  });
});

describe("searchReposByTopic", () => {
  it("uses GitHub search API with topic query", async () => {
    const client = createMockClient({ "/search/repositories": searchFixture });
    const result = await searchReposByTopic(client, "react");

    expect(result).toHaveLength(2);
    expect(result[0].fullName).toBe("facebook/react");
    expect(result[0].stars).toBe(220000);

    const callArgs = (client.get as ReturnType<typeof vi.fn>).mock.calls[0];
    const params = callArgs[1] as Record<string, string>;
    expect(params.q).toContain("topic:react");
    expect(params.sort).toBe("stars");
  });

  it("includes language filter when provided", async () => {
    const client = createMockClient({ "/search/repositories": searchFixture });
    await searchReposByTopic(client, "react", "TypeScript");

    const callArgs = (client.get as ReturnType<typeof vi.fn>).mock.calls[0];
    const params = callArgs[1] as Record<string, string>;
    expect(params.q).toContain("language:TypeScript");
  });

  it("includes minStars filter when provided", async () => {
    const client = createMockClient({ "/search/repositories": searchFixture });
    await searchReposByTopic(client, "react", undefined, 1000);

    const callArgs = (client.get as ReturnType<typeof vi.fn>).mock.calls[0];
    const params = callArgs[1] as Record<string, string>;
    expect(params.q).toContain("stars:>=1000");
  });

  it("handles empty results", async () => {
    const client = createMockClient({ "/search/repositories": { items: [] } });
    const result = await searchReposByTopic(client, "nonexistent-topic");

    expect(result).toHaveLength(0);
  });
});
