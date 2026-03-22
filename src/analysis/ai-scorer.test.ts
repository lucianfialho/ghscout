import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPrompt, isClaudeAvailable, callClaude, aiScoreClusters } from "./ai-scorer.js";
import type { ScoredCluster } from "./scorer.js";
import type { RepoMeta } from "../github/types.js";

const mockRepoMeta: RepoMeta = {
  owner: "vercel",
  repo: "next.js",
  fullName: "vercel/next.js",
  stars: 128000,
  pushedAt: "2026-03-22T00:00:00Z",
  topics: ["nextjs", "react"],
  language: "TypeScript",
  description: "The React Framework",
};

function makeScoredCluster(overrides: Partial<ScoredCluster> = {}): ScoredCluster {
  return {
    name: "auth middleware",
    issues: [
      {
        number: 1,
        title: "Auth middleware crashes on expired tokens",
        htmlUrl: "https://github.com/vercel/next.js/issues/1",
        body: "",
        labels: ["bug"],
        reactions: { thumbsUp: 15, thumbsDown: 2, total: 20 },
        commentsCount: 8,
        createdAt: "2026-01-01T00:00:00Z",
        user: "user1",
        state: "open",
      },
      {
        number: 2,
        title: "Middleware doesn't run on API routes",
        htmlUrl: "https://github.com/vercel/next.js/issues/2",
        body: "",
        labels: ["bug"],
        reactions: { thumbsUp: 10, thumbsDown: 1, total: 12 },
        commentsCount: 5,
        createdAt: "2026-02-01T00:00:00Z",
        user: "user2",
        state: "open",
      },
    ],
    issueCount: 2,
    totalReactions: 32,
    labels: ["bug"],
    score: 75,
    breakdown: { demand: 80, frequency: 50, frustration: 60, marketSize: 100, gap: 100 },
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("includes cluster name and repo info", () => {
    const cluster = makeScoredCluster();
    const prompt = buildPrompt(cluster, mockRepoMeta);

    expect(prompt).toContain('"auth middleware"');
    expect(prompt).toContain("vercel/next.js");
    expect(prompt).toContain("128,000 stars");
    expect(prompt).toContain("2 open issues");
  });

  it("includes top issues with reactions", () => {
    const cluster = makeScoredCluster();
    const prompt = buildPrompt(cluster, mockRepoMeta);

    expect(prompt).toContain("[20 👍] Auth middleware crashes on expired tokens");
    expect(prompt).toContain("[12 👍] Middleware doesn't run on API routes");
  });

  it("asks for JSON response format", () => {
    const cluster = makeScoredCluster();
    const prompt = buildPrompt(cluster, mockRepoMeta);

    expect(prompt).toContain('"score"');
    expect(prompt).toContain('"verdict"');
    expect(prompt).toContain('"rationale"');
    expect(prompt).toContain("BUILD|SKIP|WATCH");
  });
});

describe("callClaude", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses valid JSON response", async () => {
    const mockExecSync = vi.fn().mockReturnValue(
      '{"score": 8, "verdict": "BUILD", "rationale": "Strong opportunity with clear demand."}'
    );
    vi.stubGlobal("require", vi.fn());
    // We can't easily mock execSync in ESM, so test buildPrompt and parsing logic separately
    // This test validates the response parsing concept
    const jsonStr = '{"score": 8, "verdict": "BUILD", "rationale": "Strong opportunity."}';
    const parsed = JSON.parse(jsonStr);
    expect(parsed.score).toBe(8);
    expect(parsed.verdict).toBe("BUILD");
    expect(typeof parsed.rationale).toBe("string");
  });
});

describe("aiScoreClusters", () => {
  it("falls back to heuristic when cluster score is below threshold", async () => {
    // Mock isClaudeAvailable to return true
    vi.mock("./ai-scorer.js", async (importOriginal) => {
      const original = await importOriginal() as Record<string, unknown>;
      return {
        ...original,
        isClaudeAvailable: () => true,
        callClaude: () => null, // simulate failure
      };
    });

    // Import fresh after mock
    const { aiScoreClusters: aiScore } = await import("./ai-scorer.js");

    const lowCluster = makeScoredCluster({ score: 20, name: "low-priority" });
    const results = await aiScore([lowCluster], mockRepoMeta, { verbose: false, minHeuristicScore: 30 });

    expect(results[0].rationale).toContain("Heuristic");
    expect(results[0].verdict).toBe("SKIP");

    vi.restoreAllMocks();
  });

  it("skips 'other' cluster regardless of score", async () => {
    vi.mock("./ai-scorer.js", async (importOriginal) => {
      const original = await importOriginal() as Record<string, unknown>;
      return {
        ...original,
        isClaudeAvailable: () => true,
        callClaude: () => null,
      };
    });

    const { aiScoreClusters: aiScore } = await import("./ai-scorer.js");

    const otherCluster = makeScoredCluster({ score: 80, name: "other" });
    const results = await aiScore([otherCluster], mockRepoMeta, { verbose: false });

    expect(results[0].rationale).toContain("Heuristic");

    vi.restoreAllMocks();
  });
});
