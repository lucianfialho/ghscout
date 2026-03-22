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

  constructor(token: string | null) {
    this.token = token;
  }

  async get<T>(url: string, params?: Record<string, string>): Promise<T> {
    const fullUrl = new URL(url);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        fullUrl.searchParams.set(key, value);
      }
    }

    const headers = buildHeaders(this.token);
    const response = await fetch(fullUrl.toString(), { headers });

    this.trackRateLimit(response);

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
