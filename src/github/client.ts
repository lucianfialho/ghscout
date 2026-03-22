import { buildHeaders } from "./auth.js";

export class RateLimitError extends Error {
  constructor(public resetAt: number) {
    super(`GitHub API rate limit exhausted. Resets at ${new Date(resetAt * 1000).toISOString()}`);
    this.name = "RateLimitError";
  }
}

export class GitHubClient {
  private token: string | null;
  private rateLimit: number | null = null;
  private rateLimitRemaining: number | null = null;
  private searchRateLimit: number | null = null;
  private searchRateLimitRemaining: number | null = null;
  private searchRateLimitReset: number | null = null;
  private lastSearchTime: number = 0;

  /** Minimum delay between consecutive search requests (ms) */
  private static SEARCH_DELAY_MS = 2000;

  constructor(token: string | null) {
    this.token = token;
  }

  private isSearchUrl(url: string): boolean {
    return url.includes("/search/");
  }

  private async applySearchThrottle(): Promise<void> {
    // If search rate limit is exhausted, wait for reset
    if (this.searchRateLimitRemaining !== null && this.searchRateLimitRemaining === 0 && this.searchRateLimitReset !== null) {
      const waitMs = Math.max(0, this.searchRateLimitReset * 1000 - Date.now());
      if (waitMs > 0) {
        process.stderr.write(
          `Search rate limit exhausted. Waiting ${Math.ceil(waitMs / 1000)}s for reset...\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    // Warn when search rate limit is low
    if (
      this.searchRateLimit !== null &&
      this.searchRateLimitRemaining !== null &&
      this.searchRateLimitRemaining > 0 &&
      this.searchRateLimitRemaining < 5
    ) {
      process.stderr.write(
        `Search rate limit low (${this.searchRateLimitRemaining}/${this.searchRateLimit} remaining). Slowing down...\n`,
      );
    }

    // Enforce minimum delay between search requests
    const elapsed = Date.now() - this.lastSearchTime;
    if (this.lastSearchTime > 0 && elapsed < GitHubClient.SEARCH_DELAY_MS) {
      await new Promise((resolve) => setTimeout(resolve, GitHubClient.SEARCH_DELAY_MS - elapsed));
    }
  }

  private trackSearchRateLimit(response: Response): void {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const limit = response.headers.get("x-ratelimit-limit");
    const reset = response.headers.get("x-ratelimit-reset");

    if (limit !== null) {
      this.searchRateLimit = parseInt(limit, 10);
    }
    if (remaining !== null) {
      this.searchRateLimitRemaining = parseInt(remaining, 10);
    }
    if (reset !== null) {
      this.searchRateLimitReset = parseInt(reset, 10);
    }

    this.lastSearchTime = Date.now();
  }

  async get<T>(url: string, params?: Record<string, string>): Promise<T> {
    const isSearch = this.isSearchUrl(url);

    if (isSearch) {
      await this.applySearchThrottle();
    }

    const fullUrl = new URL(url);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        fullUrl.searchParams.set(key, value);
      }
    }

    const headers = buildHeaders(this.token);
    const response = await fetch(fullUrl.toString(), { headers });

    if (isSearch) {
      this.trackSearchRateLimit(response);
    } else {
      this.trackRateLimit(response);
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async getPaginated<T>(
    url: string,
    params?: Record<string, string>,
    maxPages: number = Infinity,
  ): Promise<T[]> {
    let results: T[] = [];
    let nextUrl: string | null = url;
    let page = 0;

    // Build initial URL with params
    if (params && nextUrl) {
      const fullUrl = new URL(nextUrl);
      for (const [key, value] of Object.entries(params)) {
        fullUrl.searchParams.set(key, value);
      }
      nextUrl = fullUrl.toString();
    }

    while (nextUrl && page < maxPages) {
      const headers = buildHeaders(this.token);
      const response = await fetch(nextUrl, { headers });

      this.trackRateLimit(response);

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as T[];
      results = results.concat(data);
      page++;

      nextUrl = this.parseNextLink(response.headers.get("link"));
    }

    return results;
  }

  private trackRateLimit(response: Response): void {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const limit = response.headers.get("x-ratelimit-limit");
    const reset = response.headers.get("x-ratelimit-reset");

    if (limit !== null) {
      this.rateLimit = parseInt(limit, 10);
    }
    if (remaining !== null) {
      this.rateLimitRemaining = parseInt(remaining, 10);
    }

    if (this.rateLimitRemaining !== null && this.rateLimitRemaining === 0) {
      const resetAt = reset ? parseInt(reset, 10) : 0;
      throw new RateLimitError(resetAt);
    }

    if (
      this.rateLimit !== null &&
      this.rateLimitRemaining !== null &&
      this.rateLimitRemaining / this.rateLimit <= 0.2
    ) {
      process.stderr.write(
        `Warning: GitHub API rate limit low — ${this.rateLimitRemaining}/${this.rateLimit} requests remaining\n`,
      );
    }
  }

  private parseNextLink(linkHeader: string | null): string | null {
    if (!linkHeader) return null;

    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
  }
}
