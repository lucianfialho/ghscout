import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/** Repo metadata TTL: 24 hours */
export const REPO_TTL = 24 * 60 * 60 * 1000;

/** Issue data TTL: 1 hour */
export const ISSUE_TTL = 60 * 60 * 1000;

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

function getCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg || join(homedir(), ".cache");
  return join(base, "ghscout");
}

/**
 * Generate a cache key from a URL and optional params.
 * Returns the first 16 chars of a sha256 hex digest.
 */
export function getCacheKey(
  url: string,
  params?: Record<string, string>,
): string {
  const input = params
    ? url + JSON.stringify(params, Object.keys(params).sort())
    : url;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Read a cached value. Returns null if missing or expired.
 */
export async function getCached<T>(
  key: string,
  ttlMs: number,
): Promise<T | null> {
  try {
    const filePath = join(getCacheDir(), `${key}.json`);
    const raw = await readFile(filePath, "utf-8");
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > ttlMs) {
      return null;
    }
    return entry.data as T;
  } catch {
    return null;
  }
}

/**
 * Write a value to the cache.
 */
export async function setCache(
  key: string,
  data: unknown,
): Promise<void> {
  const dir = getCacheDir();
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${key}.json`);
  const entry: CacheEntry = { data, timestamp: Date.now() };
  await writeFile(filePath, JSON.stringify(entry), "utf-8");
}
