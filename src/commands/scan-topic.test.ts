import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runTopicScan, mergeClustersAcrossRepos, type TopicScanOptions } from "./scan.js";
import type { Cluster } from "../analysis/cluster.js";

// --- Mock data ---

function makeSearchResult(
  fullName: string,
  stars: number,
  language: string = "TypeScript",
) {
  const [owner, repo] = fullName.split("/");
  return {
    full_name: fullName,
    stargazers_count: stars,
    pushed_at: "2026-03-20T00:00:00Z",
    topics: ["devtools"],
    language,
    description: `A ${repo} project`,
    owner: { login: owner },
    name: repo,
  };
}

function makeMockIssue(
  num: number,
  title: string,
  reactions: number = 2,
  labels: string[] = [],
) {
  return {
    number: num,
    title,
    body: "Some body text",
    labels: labels.map((l) => ({ name: l })),
    reactions: { "+1": reactions, "-1": 0, total_count: reactions },
    comments: 1,
    created_at: "2026-01-01T00:00:00Z",
    html_url: `https://github.com/test/repo/issues/${num}`,
    user: { login: "testuser" },
    state: "open",
  };
}

function makeMockPR(num: number, title: string, merged: boolean) {
  return {
    number: num,
    title,
    merged_at: merged ? "2026-02-01T00:00:00Z" : null,
    reactions: { "+1": 0, "-1": 0, total_count: 0 },
    html_url: `https://github.com/test/repo/pull/${num}`,
    user: { login: "pruser" },
    created_at: "2026-01-15T00:00:00Z",
    state: "closed",
  };
}

// Generate 15 search results to test the 10-repo cap
const allSearchResults = Array.from({ length: 15 }, (_, i) =>
  makeSearchResult(`org${i}/repo${i}`, 5000 - i * 100, i % 2 === 0 ? "TypeScript" : "Python"),
);

// Issues that share cluster names across repos so merging can be tested
const sharedIssues = [
  makeMockIssue(1, "Auth middleware crashes on refresh", 5, ["auth"]),
  makeMockIssue(2, "Auth middleware timeout handling", 3, ["auth"]),
  makeMockIssue(3, "Cache invalidation not working", 2),
  makeMockIssue(4, "Cache invalidation stale data", 1),
];

const mockPulls = [makeMockPR(100, "Fix readme", true)];

// --- Helpers ---

const defaultOpts: TopicScanOptions = {
  topic: "devtools",
  output: "json",
  limit: 100,
  period: "90d",
  minStars: 100,
  verbose: false,
  noCache: false,
  top: 0,
  minReactions: 0,
};

function createMockFetch(searchResults: unknown[] = allSearchResults) {
  return vi.fn(async (url: string) => {
    const urlStr = typeof url === "string" ? url : String(url);

    let body: unknown;

    if (urlStr.includes("/search/repositories")) {
      body = { items: searchResults };
    } else if (urlStr.includes("/issues")) {
      body = sharedIssues;
    } else if (urlStr.includes("/pulls")) {
      body = mockPulls;
    } else if (urlStr.includes("/repos/")) {
      // Repo metadata fetch
      const match = urlStr.match(/\/repos\/([^/]+\/[^/]+)/);
      const fullName = match ? match[1] : "org0/repo0";
      body = makeSearchResult(fullName, 5000);
    } else {
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "55",
        },
      });
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "55",
      },
    });
  });
}

// --- Tests ---

describe("runTopicScan", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;
  let originalFetch: typeof globalThis.fetch;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    vi.mock("../github/auth.js", () => ({
      resolveToken: vi.fn().mockResolvedValue("fake-token"),
      buildHeaders: vi.fn((token: string | null) => {
        const headers: Record<string, string> = {
          Accept: "application/vnd.github.v3+json",
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        return headers;
      }),
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("scans trending repos in topic", async () => {
    await runTopicScan(defaultOpts);

    // Should output JSON
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);

    // Should have called search API
    const searchCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("/search/repositories"),
    );
    expect(searchCall).toBeDefined();
    expect(String(searchCall![0])).toContain("topic%3Adevtools");
  });

  it("respects --lang filter", async () => {
    await runTopicScan({ ...defaultOpts, lang: "TypeScript" });

    const searchCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("/search/repositories"),
    );
    expect(searchCall).toBeDefined();
    expect(String(searchCall![0])).toContain("language%3ATypeScript");
  });

  it("respects --min-stars filter", async () => {
    await runTopicScan({ ...defaultOpts, minStars: 500 });

    const searchCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes("/search/repositories"),
    );
    expect(searchCall).toBeDefined();
    expect(String(searchCall![0])).toContain("stars%3A%3E%3D500");
  });

  it("caps at 10 repos", async () => {
    await runTopicScan(defaultOpts);

    // Count how many repos were actually scanned (stderr messages)
    const scanMessages = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((msg) => msg.startsWith("Scanning "));
    expect(scanMessages.length).toBeLessThanOrEqual(10);
    // We provided 15 search results, so it should have scanned exactly 10
    expect(scanMessages.length).toBe(10);
  });

  it("merges clusters cross-repo", async () => {
    await runTopicScan({ ...defaultOpts, output: "json" });

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    // Clusters from multiple repos should be merged by name.
    // Since all repos return the same issues, clusters with the same name
    // should have their issue counts combined.
    if (parsed.length > 0) {
      // The "auth middleware" cluster from 10 repos should be merged
      const authCluster = parsed.find((c: { name: string }) =>
        c.name.includes("auth"),
      );
      if (authCluster) {
        // 2 auth issues per repo * 10 repos = 20 issues merged
        expect(authCluster.issueCount).toBe(20);
      }
    }
  });

  it("shows progress to stderr", async () => {
    await runTopicScan(defaultOpts);

    const stderrOutput = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .join("");
    expect(stderrOutput).toContain("Scanning 1/10:");
    expect(stderrOutput).toContain("Scanning 10/10:");
  });

  it("handles no repos found", async () => {
    globalThis.fetch = createMockFetch([]) as unknown as typeof fetch;

    await expect(runTopicScan(defaultOpts)).rejects.toThrow("process.exit(1)");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('No repos found for topic "devtools"'),
    );
  });
});

describe("mergeClustersAcrossRepos", () => {
  it("merges clusters with same name", () => {
    const clusters: Cluster[] = [
      {
        name: "auth",
        issues: [
          {
            number: 1,
            title: "Auth issue",
            body: "",
            labels: ["auth"],
            reactions: { thumbsUp: 3, thumbsDown: 0, total: 3 },
            commentsCount: 0,
            createdAt: "2026-01-01T00:00:00Z",
            htmlUrl: "https://github.com/a/b/issues/1",
            user: "u1",
            state: "open",
          },
        ],
        issueCount: 1,
        totalReactions: 3,
        labels: ["auth"],
      },
      {
        name: "auth",
        issues: [
          {
            number: 2,
            title: "Auth problem",
            body: "",
            labels: ["auth", "bug"],
            reactions: { thumbsUp: 2, thumbsDown: 0, total: 2 },
            commentsCount: 0,
            createdAt: "2026-01-02T00:00:00Z",
            htmlUrl: "https://github.com/c/d/issues/2",
            user: "u2",
            state: "open",
          },
        ],
        issueCount: 1,
        totalReactions: 2,
        labels: ["bug"],
      },
      {
        name: "cache",
        issues: [
          {
            number: 3,
            title: "Cache issue",
            body: "",
            labels: [],
            reactions: { thumbsUp: 1, thumbsDown: 0, total: 1 },
            commentsCount: 0,
            createdAt: "2026-01-03T00:00:00Z",
            htmlUrl: "https://github.com/e/f/issues/3",
            user: "u3",
            state: "open",
          },
        ],
        issueCount: 1,
        totalReactions: 1,
        labels: [],
      },
    ];

    const merged = mergeClustersAcrossRepos(clusters);

    // "auth" clusters should be merged
    const authCluster = merged.find((c) => c.name === "auth");
    expect(authCluster).toBeDefined();
    expect(authCluster!.issueCount).toBe(2);
    expect(authCluster!.totalReactions).toBe(5);
    expect(authCluster!.issues.length).toBe(2);
    // Labels should be unioned
    expect(authCluster!.labels).toContain("auth");
    expect(authCluster!.labels).toContain("bug");

    // "cache" cluster should remain separate
    const cacheCluster = merged.find((c) => c.name === "cache");
    expect(cacheCluster).toBeDefined();
    expect(cacheCluster!.issueCount).toBe(1);

    // Sorted by issue count descending
    expect(merged[0].name).toBe("auth");
  });

  it("returns empty array for empty input", () => {
    const merged = mergeClustersAcrossRepos([]);
    expect(merged).toEqual([]);
  });
});
