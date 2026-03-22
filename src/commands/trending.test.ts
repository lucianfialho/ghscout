import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runTrending, thirtyDaysAgo } from "./trending.js";

// Helper to build a fake GitHub search issue item
function makeSearchIssueItem(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: "Memory leak in production",
    body: "There is a memory leak when running in production mode.",
    html_url: "https://github.com/test/repo/issues/1",
    state: "open",
    created_at: "2026-03-01T00:00:00Z",
    comments: 5,
    user: { login: "testuser" },
    labels: [{ name: "bug" }],
    reactions: {
      "+1": 15,
      "-1": 2,
      total_count: 20,
    },
    repository_url: "https://api.github.com/repos/test/repo",
    ...overrides,
  };
}

function makeSearchResponse(items: Record<string, unknown>[]) {
  return {
    total_count: items.length,
    incomplete_results: false,
    items,
  };
}

function makeRepoSearchResponse(repos: Record<string, unknown>[]) {
  return {
    total_count: repos.length,
    incomplete_results: false,
    items: repos,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    full_name: "test/repo",
    stargazers_count: 5000,
    pushed_at: "2026-03-01T00:00:00Z",
    topics: ["devtools"],
    language: "TypeScript",
    description: "A test repo",
    ...overrides,
  };
}

// Mock resolveToken
vi.mock("../github/auth.js", () => ({
  resolveToken: vi.fn().mockResolvedValue("fake-token"),
  buildHeaders: vi.fn().mockReturnValue({
    Accept: "application/vnd.github.v3+json",
    Authorization: "Bearer fake-token",
  }),
}));

describe("trending command", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();
    stderrSpy.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns clustered results from high-reaction issues", async () => {
    const items = [
      makeSearchIssueItem({
        number: 1,
        title: "Memory leak in production server",
        reactions: { "+1": 20, "-1": 1, total_count: 25 },
      }),
      makeSearchIssueItem({
        number: 2,
        title: "Memory leak when using SSR",
        reactions: { "+1": 15, "-1": 0, total_count: 18 },
      }),
      makeSearchIssueItem({
        number: 3,
        title: "Slow cold start performance",
        reactions: { "+1": 10, "-1": 0, total_count: 12 },
      }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeSearchResponse(items)),
      headers: new Headers({
        "x-ratelimit-limit": "30",
        "x-ratelimit-remaining": "25",
      }),
    });

    await runTrending({
      output: "json",
      top: 10,
      verbose: false,
      noCache: false,
    });

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("meta");
    expect(Array.isArray(parsed.clusters)).toBe(true);
    expect(parsed.clusters.length).toBeGreaterThan(0);
    // Check that clusters have expected properties
    expect(parsed.clusters[0]).toHaveProperty("score");
    expect(parsed.clusters[0]).toHaveProperty("issueCount");
    expect(parsed.clusters[0]).toHaveProperty("totalReactions");
  });

  it("filters by topic (searches repos first, then issues)", async () => {
    // First call: search repos by topic
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve(
          makeRepoSearchResponse([
            makeRepo({ full_name: "org/tool-a" }),
            makeRepo({ full_name: "org/tool-b" }),
          ]),
        ),
      headers: new Headers({
        "x-ratelimit-limit": "30",
        "x-ratelimit-remaining": "25",
      }),
    });

    // Second call: search issues in org/tool-a
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve(
          makeSearchResponse([
            makeSearchIssueItem({
              number: 10,
              title: "Auth flow broken on mobile",
              repository_url: "https://api.github.com/repos/org/tool-a",
            }),
            makeSearchIssueItem({
              number: 11,
              title: "Auth token refresh fails",
              repository_url: "https://api.github.com/repos/org/tool-a",
            }),
          ]),
        ),
      headers: new Headers({
        "x-ratelimit-limit": "30",
        "x-ratelimit-remaining": "24",
      }),
    });

    // Third call: search issues in org/tool-b
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve(makeSearchResponse([])),
      headers: new Headers({
        "x-ratelimit-limit": "30",
        "x-ratelimit-remaining": "23",
      }),
    });

    await runTrending({
      output: "json",
      top: 10,
      topic: "devtools",
      verbose: false,
      noCache: false,
    });

    // Verify it searched repos first (topic search)
    const firstCallUrl = mockFetch.mock.calls[0][0];
    expect(firstCallUrl).toContain("search/repositories");
    expect(firstCallUrl).toContain("topic%3Adevtools");

    // Verify it then searched issues in the repos
    const secondCallUrl = mockFetch.mock.calls[1][0];
    expect(secondCallUrl).toContain("search/issues");
    expect(secondCallUrl).toContain("org%2Ftool-a");

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("meta");
    expect(Array.isArray(parsed.clusters)).toBe(true);
  });

  it("filters by lang", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve(
          makeSearchResponse([
            makeSearchIssueItem({
              number: 1,
              title: "Type inference broken",
              reactions: { "+1": 12, "-1": 0, total_count: 14 },
            }),
            makeSearchIssueItem({
              number: 2,
              title: "Type inference slow for generics",
              reactions: { "+1": 10, "-1": 0, total_count: 11 },
            }),
          ]),
        ),
      headers: new Headers({
        "x-ratelimit-limit": "30",
        "x-ratelimit-remaining": "25",
      }),
    });

    await runTrending({
      output: "json",
      top: 10,
      lang: "typescript",
      verbose: false,
      noCache: false,
    });

    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain("search/issues");
    expect(callUrl).toContain("language%3Atypescript");

    expect(consoleSpy).toHaveBeenCalled();
  });

  it("clusters and scores results", async () => {
    const items = [
      makeSearchIssueItem({
        number: 1,
        title: "Hot reload broken after upgrade",
        reactions: { "+1": 30, "-1": 5, total_count: 40 },
      }),
      makeSearchIssueItem({
        number: 2,
        title: "Hot reload stops working randomly",
        reactions: { "+1": 25, "-1": 3, total_count: 32 },
      }),
      makeSearchIssueItem({
        number: 3,
        title: "Hot reload fails with CSS modules",
        reactions: { "+1": 20, "-1": 2, total_count: 24 },
      }),
      makeSearchIssueItem({
        number: 4,
        title: "Docker build extremely slow",
        reactions: { "+1": 15, "-1": 1, total_count: 18 },
      }),
      makeSearchIssueItem({
        number: 5,
        title: "Docker build cache invalidation",
        reactions: { "+1": 12, "-1": 0, total_count: 14 },
      }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeSearchResponse(items)),
      headers: new Headers({
        "x-ratelimit-limit": "30",
        "x-ratelimit-remaining": "25",
      }),
    });

    await runTrending({
      output: "json",
      top: 10,
      verbose: false,
      noCache: false,
    });

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("meta");
    expect(Array.isArray(parsed.clusters)).toBe(true);
    expect(parsed.clusters.length).toBeGreaterThan(0);

    // Clusters should be scored (have score and breakdown)
    for (const cluster of parsed.clusters) {
      expect(cluster).toHaveProperty("score");
      expect(typeof cluster.score).toBe("number");
      expect(cluster.score).toBeGreaterThanOrEqual(0);
      expect(cluster.score).toBeLessThanOrEqual(100);
      expect(cluster).toHaveProperty("breakdown");
      expect(cluster.breakdown).toHaveProperty("demand");
      expect(cluster.breakdown).toHaveProperty("frequency");
      expect(cluster.breakdown).toHaveProperty("frustration");
      expect(cluster.breakdown).toHaveProperty("marketSize");
      expect(cluster.breakdown).toHaveProperty("gap");
    }

    // Clusters should be sorted by score descending
    for (let i = 1; i < parsed.clusters.length; i++) {
      expect(parsed.clusters[i - 1].score).toBeGreaterThanOrEqual(parsed.clusters[i].score);
    }
  });

  it("date calculation returns 30 days ago in YYYY-MM-DD format", () => {
    const result = thirtyDaysAgo();
    // Should match YYYY-MM-DD format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Should be approximately 30 days ago
    const date = new Date(result);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(29);
    expect(diffDays).toBeLessThanOrEqual(31);
  });

  it("handles no results gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeSearchResponse([])),
      headers: new Headers({
        "x-ratelimit-limit": "30",
        "x-ratelimit-remaining": "25",
      }),
    });

    await runTrending({
      output: "json",
      top: 10,
      verbose: false,
      noCache: false,
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "No trending issues found matching your criteria.",
    );
  });
});
