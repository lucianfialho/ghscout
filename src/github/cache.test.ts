import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCached, setCache, getCacheKey } from "./cache.js";

describe("cache", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghscout-cache-test-"));
    vi.stubEnv("XDG_CACHE_HOME", tmpDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null for uncached keys", async () => {
    const result = await getCached("nonexistent", 60_000);
    expect(result).toBeNull();
  });

  it("caches and retrieves data", async () => {
    const data = { stars: 42, name: "test-repo" };
    const key = getCacheKey("https://api.github.com/repos/foo/bar");

    await setCache(key, data);
    const result = await getCached(key, 60_000);

    expect(result).toEqual(data);
  });

  it("returns null for expired entries", async () => {
    const key = getCacheKey("https://api.github.com/repos/expired");
    await setCache(key, { old: true });

    // Move timestamp back by overriding Date.now
    const original = Date.now;
    Date.now = () => original() + 120_000; // 2 minutes in the future

    const result = await getCached(key, 60_000); // 1 minute TTL
    expect(result).toBeNull();

    Date.now = original;
  });

  it("different URLs get different cache keys", () => {
    const key1 = getCacheKey("https://api.github.com/repos/foo/bar");
    const key2 = getCacheKey("https://api.github.com/repos/baz/qux");

    expect(key1).not.toBe(key2);
    expect(key1).toHaveLength(16);
    expect(key2).toHaveLength(16);
  });

  it("same URL with different params get different keys", () => {
    const url = "https://api.github.com/repos/foo/bar/issues";
    const key1 = getCacheKey(url, { state: "open" });
    const key2 = getCacheKey(url, { state: "closed" });

    expect(key1).not.toBe(key2);
  });

  it("same URL with same params get same key regardless of param order", () => {
    const url = "https://api.github.com/repos/foo/bar/issues";
    const key1 = getCacheKey(url, { state: "open", per_page: "100" });
    const key2 = getCacheKey(url, { per_page: "100", state: "open" });

    expect(key1).toBe(key2);
  });
});
