import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runScan, type ScanOptions } from "./scan.js";

// --- Mock data ---

const mockRepoMeta = {
  full_name: "test/repo",
  stargazers_count: 5000,
  pushed_at: "2026-03-20T00:00:00Z",
  topics: ["typescript"],
  language: "TypeScript",
  description: "A test repo",
};

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

function makeMockPR(
  num: number,
  title: string,
  merged: boolean,
  reactions: number = 0,
) {
  return {
    number: num,
    title,
    merged_at: merged ? "2026-02-01T00:00:00Z" : null,
    reactions: { "+1": reactions, "-1": 0, total_count: reactions },
    html_url: `https://github.com/test/repo/pull/${num}`,
    user: { login: "pruser" },
    created_at: "2026-01-15T00:00:00Z",
    state: "closed",
  };
}

const mockIssues = [
  makeMockIssue(1, "Auth middleware crashes on refresh token", 5, [
    "auth",
    "bug",
  ]),
  makeMockIssue(2, "Auth middleware timeout handling broken", 3, [
    "auth",
    "bug",
  ]),
  makeMockIssue(3, "Auth middleware does not work with SSR", 4, ["auth"]),
  makeMockIssue(4, "Performance slow on large dataset rendering", 6, [
    "performance",
  ]),
  makeMockIssue(5, "Performance slow when filtering large lists", 2, [
    "performance",
  ]),
  makeMockIssue(6, "Cache invalidation not working properly", 1),
  makeMockIssue(7, "Cache invalidation causes stale data", 3),
  makeMockIssue(8, "Minor typo in docs page", 0),
];

const mockPulls = [
  makeMockPR(100, "Add auth middleware caching", false, 5), // rejected with demand
  makeMockPR(101, "Fix typo in readme", true, 0), // merged
  makeMockPR(102, "Add SSR support for auth", false, 1), // rejected but low reactions
];

// --- Helpers ---

const defaultOpts: ScanOptions = {
  output: "pretty",
  limit: 100,
  period: "90d",
  minStars: 100,
  verbose: false,
  noCache: false,
  top: 0,
  minReactions: 0,
};

// Track what fetch returns based on URL
function createMockFetch() {
  return vi.fn(async (url: string) => {
    const urlStr = typeof url === "string" ? url : String(url);

    let body: unknown;

    if (urlStr.includes("/repos/test/repo/issues")) {
      body = mockIssues;
    } else if (urlStr.includes("/repos/test/repo/pulls")) {
      body = mockPulls;
    } else if (urlStr.includes("/repos/test/repo")) {
      body = mockRepoMeta;
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

describe("runScan", () => {
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

    // Mock process.exit so it throws instead of killing the test
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    // Mock resolveToken to return a fake token
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

  it("validates invalid repo format (no slash)", async () => {
    await expect(runScan("invalidrepo", defaultOpts)).rejects.toThrow(
      "process.exit(1)",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid repo format"),
    );
  });

  it("validates empty repo string", async () => {
    await expect(runScan("", defaultOpts)).rejects.toThrow("process.exit(1)");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid repo format"),
    );
  });

  it("runs full scan flow and outputs clusters", async () => {
    await runScan("test/repo", defaultOpts);

    // Should have called fetch at least 3 times (repo meta, issues, pulls)
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Should have printed output (console.log called at least once)
    expect(consoleSpy).toHaveBeenCalled();

    // Check that output includes cluster information
    const allOutput = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    // The output should reference clusters (pretty format by default)
    expect(allOutput.length).toBeGreaterThan(0);
  });

  it("outputs valid JSON with --output json", async () => {
    await runScan("test/repo", { ...defaultOpts, output: "json" });

    // First console.log call should be the JSON output
    const firstCall = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(firstCall);
    expect(Array.isArray(parsed)).toBe(true);
    // Each item should have score and breakdown
    if (parsed.length > 0) {
      expect(parsed[0]).toHaveProperty("score");
      expect(parsed[0]).toHaveProperty("breakdown");
      expect(parsed[0]).toHaveProperty("name");
      expect(parsed[0]).toHaveProperty("issueCount");
    }
  });

  it("outputs table format with --output table", async () => {
    await runScan("test/repo", { ...defaultOpts, output: "table" });

    const allOutput = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    // Table output should have headers
    expect(allOutput).toContain("Score");
    expect(allOutput).toContain("Cluster");
    expect(allOutput).toContain("Issues");
  });

  it("shows verbose logs to stderr", async () => {
    await runScan("test/repo", { ...defaultOpts, verbose: true });

    const stderrOutput = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .join("");
    expect(stderrOutput).toContain("Fetching repo metadata...");
    expect(stderrOutput).toContain("Fetching issues");
    expect(stderrOutput).toContain("Fetching closed PRs...");
    expect(stderrOutput).toContain("Clustering");
  });

  it("prints rejected PRs section when present", async () => {
    await runScan("test/repo", defaultOpts);

    const allOutput = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("Rejected PRs with demand:");
    expect(allOutput).toContain("Add auth middleware caching");
  });

  it("respects --top flag", async () => {
    await runScan("test/repo", { ...defaultOpts, output: "json", top: 1 });

    const firstCall = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(firstCall);
    expect(parsed.length).toBeLessThanOrEqual(1);
  });

  it("respects --min-reactions filter", async () => {
    await runScan("test/repo", {
      ...defaultOpts,
      output: "json",
      minReactions: 9999,
    });

    const firstCall = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(firstCall);
    // With minReactions=9999, no clusters should pass
    expect(parsed.length).toBe(0);
  });

  it("handles repo not found (404) gracefully", async () => {
    await expect(
      runScan("nonexistent/repo", defaultOpts),
    ).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
    );
  });

  it("handles rate limit error gracefully", async () => {
    // Override fetch to return rate-limited response
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ message: "rate limit exceeded" }), {
        status: 403,
        statusText: "Forbidden",
        headers: {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1711036800",
        },
      });
    }) as unknown as typeof fetch;

    await expect(
      runScan("test/repo", defaultOpts),
    ).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Rate limit exhausted"),
    );
  });
});
