import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runOrgScan } from "./scan-org.js";
import type { ScanOptions } from "./scan.js";

// --- Mock data ---

function makeMockOrgRepo(
  org: string,
  name: string,
  stars: number,
) {
  return {
    full_name: `${org}/${name}`,
    stargazers_count: stars,
    pushed_at: "2026-03-20T00:00:00Z",
    topics: ["typescript"],
    language: "TypeScript",
    description: `${name} repo`,
  };
}

function makeMockIssue(
  owner: string,
  repo: string,
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
    html_url: `https://github.com/${owner}/${repo}/issues/${num}`,
    user: { login: "testuser" },
    state: "open",
  };
}

function makeMockPR(
  owner: string,
  repo: string,
  num: number,
  title: string,
  merged: boolean,
) {
  return {
    number: num,
    title,
    merged_at: merged ? "2026-02-01T00:00:00Z" : null,
    reactions: { "+1": 0, "-1": 0, total_count: 0 },
    html_url: `https://github.com/${owner}/${repo}/pull/${num}`,
    user: { login: "pruser" },
    created_at: "2026-01-15T00:00:00Z",
    state: "closed",
  };
}

// 12 repos for the org, to test the cap at 10
const orgRepos = [
  makeMockOrgRepo("testorg", "repo-a", 10000),
  makeMockOrgRepo("testorg", "repo-b", 8000),
  makeMockOrgRepo("testorg", "repo-c", 6000),
  makeMockOrgRepo("testorg", "repo-d", 5000),
  makeMockOrgRepo("testorg", "repo-e", 4000),
  makeMockOrgRepo("testorg", "repo-f", 3000),
  makeMockOrgRepo("testorg", "repo-g", 2000),
  makeMockOrgRepo("testorg", "repo-h", 1500),
  makeMockOrgRepo("testorg", "repo-i", 1000),
  makeMockOrgRepo("testorg", "repo-j", 800),
  makeMockOrgRepo("testorg", "repo-k", 500),
  makeMockOrgRepo("testorg", "repo-l", 50),
];

// Issues for repo-a and repo-b share a cluster name ("auth middleware")
const repoAIssues = [
  makeMockIssue("testorg", "repo-a", 1, "Auth middleware crashes on refresh token", 5, ["auth"]),
  makeMockIssue("testorg", "repo-a", 2, "Auth middleware timeout handling broken", 3, ["auth"]),
  makeMockIssue("testorg", "repo-a", 3, "Performance slow on large dataset", 2, ["performance"]),
];

const repoBIssues = [
  makeMockIssue("testorg", "repo-b", 10, "Auth middleware does not work with SSR", 4, ["auth"]),
  makeMockIssue("testorg", "repo-b", 11, "Auth middleware returns 401 unexpectedly", 6, ["auth"]),
  makeMockIssue("testorg", "repo-b", 12, "Cache invalidation not working", 1),
];

const emptyPulls: unknown[] = [];

// --- Helpers ---

const defaultOpts: ScanOptions = {
  output: "json",
  limit: 100,
  period: "90d",
  minStars: 0,
  verbose: false,
  noCache: false,
  top: 0,
  minReactions: 0,
};

function createMockFetch() {
  return vi.fn(async (url: string) => {
    const urlStr = typeof url === "string" ? url : String(url);

    let body: unknown;

    // Org repos endpoint
    if (urlStr.includes("/orgs/testorg/repos")) {
      body = orgRepos;
    }
    // Per-repo issues
    else if (urlStr.includes("/repos/testorg/repo-a/issues")) {
      body = repoAIssues;
    } else if (urlStr.includes("/repos/testorg/repo-b/issues")) {
      body = repoBIssues;
    } else if (urlStr.match(/\/repos\/testorg\/repo-[c-l]\/issues/)) {
      body = [];
    }
    // Per-repo pulls
    else if (urlStr.match(/\/repos\/testorg\/repo-[a-l]\/pulls/)) {
      body = emptyPulls;
    }
    // Per-repo metadata (for any testorg repo)
    else if (urlStr.match(/\/repos\/testorg\/repo-[a-l]$/)) {
      const repoName = urlStr.match(/\/repos\/testorg\/(repo-[a-l])$/)?.[1];
      const found = orgRepos.find((r) => r.full_name === `testorg/${repoName}`);
      body = found ?? { message: "Not Found" };
    } else {
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        statusText: "Not Found",
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

describe("runOrgScan", () => {
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

  it("scans top repos of an org", async () => {
    await runOrgScan("testorg", defaultOpts);

    // Should have called fetch: 1 for org repos + N*(issues + pulls) for each repo
    expect(mockFetch).toHaveBeenCalled();

    // Should output JSON
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("filters repos by min-stars", async () => {
    // Set minStars to 5000 — only repo-a (10000), repo-b (8000), repo-c (6000), repo-d (5000) qualify
    await runOrgScan("testorg", { ...defaultOpts, minStars: 5000 });

    // Check that only repos with >= 5000 stars were scanned
    const stderrOutput = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .join("");

    // Should scan 4 repos
    expect(stderrOutput).toContain("Scanning 1/4");
    expect(stderrOutput).toContain("Scanning 4/4");
    expect(stderrOutput).not.toContain("Scanning 5/");
  });

  it("caps at 10 repos", async () => {
    // We have 12 repos with minStars=0, should only scan 10
    await runOrgScan("testorg", defaultOpts);

    const stderrOutput = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .join("");

    expect(stderrOutput).toContain("Scanning 1/10");
    expect(stderrOutput).toContain("Scanning 10/10");
    expect(stderrOutput).not.toContain("Scanning 11/");
  });

  it("merges clusters across repos", async () => {
    await runOrgScan("testorg", defaultOpts);

    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    // repo-a has 2 "auth middleware" issues, repo-b has 2 "auth middleware" issues
    // They should merge into one cluster
    const authCluster = parsed.find(
      (c: { name: string }) =>
        c.name.includes("auth") && c.name.includes("middleware"),
    );

    if (authCluster) {
      // Merged cluster should have issues from both repos
      expect(authCluster.issueCount).toBeGreaterThanOrEqual(3);
    }

    // Verify no duplicate cluster names
    const names = parsed.map((c: { name: string }) => c.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("logs progress to stderr", async () => {
    await runOrgScan("testorg", defaultOpts);

    const stderrOutput = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .join("");

    // Should show fetching message
    expect(stderrOutput).toContain('Fetching repos for org "testorg"');

    // Should show scanning progress for each repo
    expect(stderrOutput).toContain("Scanning 1/10: testorg/repo-a...");
    expect(stderrOutput).toContain("Scanning 2/10: testorg/repo-b...");
  });

  it("errors when no repos found", async () => {
    // Set absurdly high minStars so no repos qualify
    await expect(
      runOrgScan("testorg", { ...defaultOpts, minStars: 999999 }),
    ).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("No repos found"),
    );
  });
});
