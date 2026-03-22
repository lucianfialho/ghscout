import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitHubClient, RateLimitError } from "./client.js";

function mockFetchResponse(
  body: unknown,
  headers: Record<string, string> = {},
  status = 200,
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    headers: new Headers(headers),
  } as Response;
}

describe("GitHubClient", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("get()", () => {
    it("makes authenticated request when token provided", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ id: 1 }, {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
        }),
      );

      const client = new GitHubClient("my-token");
      const result = await client.get<{ id: number }>("https://api.github.com/repos/foo/bar");

      expect(result).toEqual({ id: 1 });
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.github.com/repos/foo/bar");
      expect(opts.headers["Authorization"]).toBe("Bearer my-token");
      expect(opts.headers["Accept"]).toBe("application/vnd.github.v3+json");
    });

    it("makes unauthenticated request when no token", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ id: 1 }, {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "59",
        }),
      );

      const client = new GitHubClient(null);
      await client.get("https://api.github.com/repos/foo/bar");

      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers["Authorization"]).toBeUndefined();
      expect(opts.headers["Accept"]).toBe("application/vnd.github.v3+json");
    });

    it("appends query params to URL", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse([], {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
        }),
      );

      const client = new GitHubClient(null);
      await client.get("https://api.github.com/repos/foo/bar/issues", {
        state: "open",
        per_page: "100",
      });

      const [url] = fetchSpy.mock.calls[0];
      const parsed = new URL(url);
      expect(parsed.searchParams.get("state")).toBe("open");
      expect(parsed.searchParams.get("per_page")).toBe("100");
    });
  });

  describe("rate limit tracking", () => {
    it("warns to stderr when rate limit below 20%", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ id: 1 }, {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "15",
        }),
      );

      const client = new GitHubClient("token");
      await client.get("https://api.github.com/repos/foo/bar");

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("rate limit low"),
      );

      stderrSpy.mockRestore();
    });

    it("does not warn when rate limit above 20%", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ id: 1 }, {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "80",
        }),
      );

      const client = new GitHubClient("token");
      await client.get("https://api.github.com/repos/foo/bar");

      expect(stderrSpy).not.toHaveBeenCalled();

      stderrSpy.mockRestore();
    });

    it("throws RateLimitError when remaining is 0", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ message: "rate limit" }, {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1700000000",
        }),
      );

      const client = new GitHubClient("token");

      await expect(
        client.get("https://api.github.com/repos/foo/bar"),
      ).rejects.toThrow(RateLimitError);
    });

    it("RateLimitError includes reset timestamp", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ message: "rate limit" }, {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1700000000",
        }),
      );

      const client = new GitHubClient("token");

      try {
        await client.get("https://api.github.com/repos/foo/bar");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).resetAt).toBe(1700000000);
      }
    });
  });

  describe("search rate limiting", () => {
    it("tracks search rate limit separately for /search/ URLs", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      // First call: non-search URL with low general rate limit
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ id: 1 }, {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
        }),
      );
      // Second call: search URL with healthy search rate limit
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ items: [] }, {
          "x-ratelimit-limit": "30",
          "x-ratelimit-remaining": "25",
        }),
      );

      const client = new GitHubClient("token");
      await client.get("https://api.github.com/repos/foo/bar");
      await client.get("https://api.github.com/search/issues?q=test");

      // Should not warn since search remaining (25) is >= 5
      const searchWarnings = stderrSpy.mock.calls.filter(
        (c) => String(c[0]).includes("Search rate limit"),
      );
      expect(searchWarnings).toHaveLength(0);

      stderrSpy.mockRestore();
    });

    it("warns when search rate limit is low (< 5 remaining)", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      // First search call returns low remaining
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ items: [] }, {
          "x-ratelimit-limit": "30",
          "x-ratelimit-remaining": "3",
        }),
      );
      // Second search call — should trigger warning before making the request
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ items: [] }, {
          "x-ratelimit-limit": "30",
          "x-ratelimit-remaining": "2",
        }),
      );

      const client = new GitHubClient("token");
      await client.get("https://api.github.com/search/issues?q=test1");
      await client.get("https://api.github.com/search/issues?q=test2");

      const searchWarnings = stderrSpy.mock.calls.filter(
        (c) => String(c[0]).includes("Search rate limit low"),
      );
      expect(searchWarnings.length).toBeGreaterThanOrEqual(1);
      expect(String(searchWarnings[0][0])).toContain("3/30 remaining");

      stderrSpy.mockRestore();
    });

    it("waits when search rate limit is exhausted", async () => {
      vi.useFakeTimers();
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const nowSec = Math.floor(Date.now() / 1000);

      // First call exhausts the search rate limit
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ items: [] }, {
          "x-ratelimit-limit": "30",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(nowSec + 30),
        }),
      );
      // Second call after wait
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ items: [] }, {
          "x-ratelimit-limit": "30",
          "x-ratelimit-remaining": "29",
        }),
      );

      const client = new GitHubClient("token");
      await client.get("https://api.github.com/search/issues?q=test1");

      // Start the second call (it will wait on setTimeout)
      const secondCall = client.get("https://api.github.com/search/issues?q=test2");

      // Advance timers to resolve the wait
      await vi.advanceTimersByTimeAsync(35000);

      await secondCall;

      const exhaustedWarnings = stderrSpy.mock.calls.filter(
        (c) => String(c[0]).includes("Search rate limit exhausted"),
      );
      expect(exhaustedWarnings.length).toBeGreaterThanOrEqual(1);

      stderrSpy.mockRestore();
      vi.useRealTimers();
    });

    it("enforces delay between consecutive search requests", async () => {
      fetchSpy.mockResolvedValue(
        mockFetchResponse({ items: [] }, {
          "x-ratelimit-limit": "30",
          "x-ratelimit-remaining": "28",
        }),
      );

      const client = new GitHubClient("token");
      const start = Date.now();
      await client.get("https://api.github.com/search/issues?q=test1");
      await client.get("https://api.github.com/search/issues?q=test2");
      const elapsed = Date.now() - start;

      // Second search should have been delayed by ~2s
      expect(elapsed).toBeGreaterThanOrEqual(1900);
    });

    it("does not delay non-search requests", async () => {
      fetchSpy.mockResolvedValue(
        mockFetchResponse({ id: 1 }, {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
        }),
      );

      const client = new GitHubClient("token");
      const start = Date.now();
      await client.get("https://api.github.com/repos/foo/bar");
      await client.get("https://api.github.com/repos/foo/baz");
      const elapsed = Date.now() - start;

      // Non-search requests should be fast
      expect(elapsed).toBeLessThan(500);
    });

    it("does not throw RateLimitError for exhausted search limit (waits instead)", async () => {
      // Search endpoint with 0 remaining should wait, not throw
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ items: [] }, {
          "x-ratelimit-limit": "30",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 2),
        }),
      );
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ items: [] }, {
          "x-ratelimit-limit": "30",
          "x-ratelimit-remaining": "29",
        }),
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const client = new GitHubClient("token");

      // First call should succeed (trackSearchRateLimit records 0 remaining but doesn't throw)
      await client.get("https://api.github.com/search/issues?q=test1");
      // Second call should wait and succeed, not throw
      await client.get("https://api.github.com/search/issues?q=test2");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      stderrSpy.mockRestore();
    });
  });

  describe("getPaginated()", () => {
    it("follows Link header for next pages", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockFetchResponse([{ id: 1 }, { id: 2 }], {
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4998",
            link: '<https://api.github.com/repos/foo/bar/issues?page=2>; rel="next", <https://api.github.com/repos/foo/bar/issues?page=3>; rel="last"',
          }),
        )
        .mockResolvedValueOnce(
          mockFetchResponse([{ id: 3 }, { id: 4 }], {
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4997",
            link: '<https://api.github.com/repos/foo/bar/issues?page=3>; rel="next", <https://api.github.com/repos/foo/bar/issues?page=3>; rel="last"',
          }),
        )
        .mockResolvedValueOnce(
          mockFetchResponse([{ id: 5 }], {
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4996",
          }),
        );

      const client = new GitHubClient("token");
      const results = await client.getPaginated<{ id: number }>(
        "https://api.github.com/repos/foo/bar/issues",
      );

      expect(results).toEqual([
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
        { id: 5 },
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("respects maxPages limit", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockFetchResponse([{ id: 1 }], {
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4998",
            link: '<https://api.github.com/repos/foo/bar/issues?page=2>; rel="next"',
          }),
        )
        .mockResolvedValueOnce(
          mockFetchResponse([{ id: 2 }], {
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4997",
            link: '<https://api.github.com/repos/foo/bar/issues?page=3>; rel="next"',
          }),
        );

      const client = new GitHubClient("token");
      const results = await client.getPaginated<{ id: number }>(
        "https://api.github.com/repos/foo/bar/issues",
        undefined,
        2,
      );

      expect(results).toEqual([{ id: 1 }, { id: 2 }]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("returns single page when no Link header", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse([{ id: 1 }], {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
        }),
      );

      const client = new GitHubClient("token");
      const results = await client.getPaginated<{ id: number }>(
        "https://api.github.com/repos/foo/bar/issues",
      );

      expect(results).toEqual([{ id: 1 }]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("passes params to initial request", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse([], {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
        }),
      );

      const client = new GitHubClient("token");
      await client.getPaginated(
        "https://api.github.com/repos/foo/bar/issues",
        { state: "open", per_page: "30" },
      );

      const [url] = fetchSpy.mock.calls[0];
      const parsed = new URL(url);
      expect(parsed.searchParams.get("state")).toBe("open");
      expect(parsed.searchParams.get("per_page")).toBe("30");
    });
  });
});
