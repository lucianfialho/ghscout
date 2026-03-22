import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runEvidence, type EvidenceOptions } from "./evidence.js";

// --- Mock data ---

function makeMockSearchItem(
  num: number,
  title: string,
  reactions: number = 2,
  labels: string[] = [],
  user: string = "testuser",
  comments: number = 1,
  createdAt: string = "2026-01-15T00:00:00Z",
) {
  return {
    number: num,
    title,
    body: "Some body text with details",
    labels: labels.map((l) => ({ name: l })),
    reactions: { "+1": reactions, "-1": 0, total_count: reactions },
    comments,
    created_at: createdAt,
    html_url: `https://github.com/test/repo/issues/${num}`,
    user: { login: user },
    state: "open",
  };
}

function makeMockPRItem(
  num: number,
  title: string,
  merged: boolean,
  reactions: number = 0,
) {
  return {
    number: num,
    title,
    body: "PR description",
    labels: [],
    reactions: { "+1": reactions, "-1": 0, total_count: reactions },
    comments: 0,
    created_at: "2026-02-01T00:00:00Z",
    html_url: `https://github.com/test/repo/pull/${num}`,
    user: { login: "pruser" },
    state: "closed",
    pull_request: { merged_at: merged ? "2026-02-15T00:00:00Z" : null },
  };
}

const mockIssueItems = [
  makeMockSearchItem(1, "Auth middleware crashes on token refresh", 47, ["bug", "auth"], "alice", 12),
  makeMockSearchItem(2, "Auth middleware timeout handling broken", 30, ["bug", "auth"], "bob", 8),
  makeMockSearchItem(3, "Auth middleware does not work with SSR", 25, ["auth"], "charlie", 5),
  makeMockSearchItem(4, "Auth middleware session expired handling", 20, ["auth"], "alice", 3),
  makeMockSearchItem(5, "Auth middleware breaks on edge runtime", 15, ["auth", "edge"], "dave", 6),
];

const mockPRItems = [
  makeMockPRItem(5678, "Fix auth middleware token handling", true, 8),
  makeMockPRItem(5679, "Add auth retry logic", false, 8),
  makeMockPRItem(5680, "Auth middleware SSR fix", true, 3),
  makeMockPRItem(5681, "Refactor auth flow", false, 1),
];

const defaultOpts: EvidenceOptions = {
  output: "pretty",
  sort: "reactions",
  limit: 20,
  verbose: false,
  noCache: false,
};

function createMockFetch() {
  return vi.fn(async (url: string) => {
    const urlStr = typeof url === "string" ? url : String(url);

    let body: unknown;

    if (urlStr.includes("/search/issues")) {
      // Distinguish between issue search and PR search
      if (urlStr.includes("is%3Apr") || urlStr.includes("is:pr")) {
        body = {
          total_count: mockPRItems.length,
          items: mockPRItems,
        };
      } else {
        body = {
          total_count: mockIssueItems.length,
          items: mockIssueItems,
        };
      }
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

describe("runEvidence", () => {
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

  it("returns matching issues for a query", async () => {
    await runEvidence("test/repo", "auth middleware", defaultOpts);

    expect(mockFetch).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    const allOutput = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("Auth middleware crashes on token refresh");
    expect(allOutput).toContain("Auth middleware timeout handling broken");
  });

  it("calculates correct summary stats (total issues, reactions, unique users)", async () => {
    await runEvidence("test/repo", "auth middleware", {
      ...defaultOpts,
      output: "json",
    });

    const jsonOutput = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(jsonOutput);

    expect(parsed.summary.totalIssues).toBe(5);
    // Total thumbsUp: 47 + 30 + 25 + 20 + 15 = 137
    expect(parsed.summary.totalReactions).toBe(137);
    // Unique users: alice, bob, charlie, dave (alice appears twice)
    expect(parsed.summary.uniqueUsers).toBe(4);
  });

  it("finds related PRs", async () => {
    await runEvidence("test/repo", "auth middleware", {
      ...defaultOpts,
      output: "json",
    });

    const jsonOutput = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(jsonOutput);

    expect(parsed.summary.relatedPRs).toBe(4);
  });

  it("respects --sort reactions (default)", async () => {
    await runEvidence("test/repo", "auth middleware", defaultOpts);

    // Verify the search API was called with reactions-+1 sort
    const issueSearchCall = mockFetch.mock.calls.find(
      (call) => {
        const u = String(call[0]);
        return u.includes("/search/issues") && !u.includes("is%3Apr") && !u.includes("is:pr");
      },
    );
    expect(issueSearchCall).toBeDefined();
    const searchUrl = String(issueSearchCall![0]);
    expect(searchUrl).toContain("sort=reactions-%2B1");
  });

  it("respects --sort comments", async () => {
    await runEvidence("test/repo", "auth middleware", {
      ...defaultOpts,
      sort: "comments",
    });

    const issueSearchCall = mockFetch.mock.calls.find(
      (call) => {
        const u = String(call[0]);
        return u.includes("/search/issues") && !u.includes("is%3Apr") && !u.includes("is:pr");
      },
    );
    expect(issueSearchCall).toBeDefined();
    const searchUrl = String(issueSearchCall![0]);
    expect(searchUrl).toContain("sort=comments");
  });

  it("respects --sort recent", async () => {
    await runEvidence("test/repo", "auth middleware", {
      ...defaultOpts,
      sort: "recent",
    });

    const issueSearchCall = mockFetch.mock.calls.find(
      (call) => {
        const u = String(call[0]);
        return u.includes("/search/issues") && !u.includes("is%3Apr") && !u.includes("is:pr");
      },
    );
    expect(issueSearchCall).toBeDefined();
    const searchUrl = String(issueSearchCall![0]);
    expect(searchUrl).toContain("sort=created");
  });

  it("outputs valid structured JSON with --output json", async () => {
    await runEvidence("test/repo", "auth middleware", {
      ...defaultOpts,
      output: "json",
    });

    const jsonOutput = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(jsonOutput);

    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("issues");
    expect(parsed.summary).toHaveProperty("totalIssues");
    expect(parsed.summary).toHaveProperty("uniqueUsers");
    expect(parsed.summary).toHaveProperty("totalReactions");
    expect(parsed.summary).toHaveProperty("relatedPRs");
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.issues.length).toBe(5);

    // Each issue should have required fields
    const issue = parsed.issues[0];
    expect(issue).toHaveProperty("number");
    expect(issue).toHaveProperty("title");
    expect(issue).toHaveProperty("htmlUrl");
    expect(issue).toHaveProperty("reactions");
    expect(issue).toHaveProperty("commentsCount");
    expect(issue).toHaveProperty("createdAt");
    expect(issue).toHaveProperty("user");
  });

  it("outputs table format with --output table", async () => {
    await runEvidence("test/repo", "auth middleware", {
      ...defaultOpts,
      output: "table",
    });

    const allOutput = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("Reactions");
    expect(allOutput).toContain("Title");
    expect(allOutput).toContain("Age");
    expect(allOutput).toContain("Comments");
    expect(allOutput).toContain("URL");
  });

  it("outputs pretty format with ## Summary and ## Top Issues sections", async () => {
    await runEvidence("test/repo", "auth middleware", defaultOpts);

    const allOutput = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain('# Evidence: "auth middleware" in test/repo');
    expect(allOutput).toContain("## Summary");
    expect(allOutput).toContain("## Top Issues by Demand");
    expect(allOutput).toContain("open issues");
    expect(allOutput).toContain("unique authors");
    expect(allOutput).toContain("demand signal");
    expect(allOutput).toContain("related PRs");
    expect(allOutput).toContain("Oldest unresolved:");
  });

  it("pretty output contains no ANSI escape codes", async () => {
    await runEvidence("test/repo", "auth middleware", defaultOpts);

    const allOutput = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    // eslint-disable-next-line no-control-regex
    expect(allOutput).not.toMatch(/\x1b\[/);
  });

  it("pretty output shows demand strength based on total reactions", async () => {
    await runEvidence("test/repo", "auth middleware", defaultOpts);

    const allOutput = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    // Total reactions = 137, which is > 100 = "strong"
    expect(allOutput).toContain("strong demand signal");
  });

  it("pretty output shows rejected PRs with demand section", async () => {
    await runEvidence("test/repo", "auth middleware", defaultOpts);

    const allOutput = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("## Rejected PRs (unmet demand)");
    expect(allOutput).toContain("closed without merge");
  });

  it("errors on invalid repo format", async () => {
    await expect(
      runEvidence("invalidrepo", "query", defaultOpts),
    ).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid repo format"),
    );
  });

  it("errors on empty repo string", async () => {
    await expect(
      runEvidence("", "query", defaultOpts),
    ).rejects.toThrow("process.exit(1)");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid repo format"),
    );
  });

  it("shows verbose logs to stderr when --verbose is set", async () => {
    await runEvidence("test/repo", "auth middleware", {
      ...defaultOpts,
      verbose: true,
    });

    const stderrOutput = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .join("");
    expect(stderrOutput).toContain("Searching issues");
    expect(stderrOutput).toContain("Searching related PRs");
  });
});
