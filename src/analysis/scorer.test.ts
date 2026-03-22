import { describe, it, expect } from "vitest";
import { scoreCluster, scoreClusters } from "./scorer.js";
import type { ScoredCluster } from "./scorer.js";
import type { Cluster } from "./cluster.js";
import type { RepoMeta, Issue } from "../github/types.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    number: 1,
    title: "Some issue title",
    body: "Issue body",
    labels: ["bug"],
    reactions: { thumbsUp: 0, thumbsDown: 0, total: 0 },
    commentsCount: 2,
    createdAt: new Date().toISOString(),
    htmlUrl: "https://github.com/owner/repo/issues/1",
    user: "testuser",
    state: "open",
    ...overrides,
  };
}

function makeCluster(overrides: Partial<Cluster> = {}): Cluster {
  const issues = overrides.issues ?? [makeIssue()];
  return {
    name: "test-cluster",
    issues,
    issueCount: issues.length,
    totalReactions: issues.reduce((s, i) => s + i.reactions.total, 0),
    labels: ["bug"],
    ...overrides,
  };
}

function makeRepoMeta(overrides: Partial<RepoMeta> = {}): RepoMeta {
  return {
    owner: "owner",
    repo: "repo",
    fullName: "owner/repo",
    stars: 5000,
    pushedAt: new Date().toISOString(),
    topics: ["typescript"],
    language: "TypeScript",
    description: "A test repo",
    ...overrides,
  };
}

describe("scoreCluster", () => {
  it("returns a score that is a 0-100 integer", () => {
    const result = scoreCluster(makeCluster(), makeRepoMeta());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.score)).toBe(true);
  });

  it("breakdown shows individual component scores", () => {
    const result = scoreCluster(makeCluster(), makeRepoMeta());
    expect(result.breakdown).toHaveProperty("demand");
    expect(result.breakdown).toHaveProperty("frequency");
    expect(result.breakdown).toHaveProperty("frustration");
    expect(result.breakdown).toHaveProperty("marketSize");
    expect(result.breakdown).toHaveProperty("gap");
    for (const value of Object.values(result.breakdown)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it("high reaction cluster scores higher on demand", () => {
    const lowReactions = makeCluster({
      issues: [
        makeIssue({ reactions: { thumbsUp: 1, thumbsDown: 0, total: 1 } }),
      ],
    });
    const highReactions = makeCluster({
      issues: [
        makeIssue({ reactions: { thumbsUp: 60, thumbsDown: 0, total: 60 } }),
      ],
    });

    const lowResult = scoreCluster(lowReactions, makeRepoMeta());
    const highResult = scoreCluster(highReactions, makeRepoMeta());

    expect(highResult.breakdown.demand).toBeGreaterThan(
      lowResult.breakdown.demand,
    );
  });

  it("many-issue cluster scores higher on frequency", () => {
    const fewIssues = makeCluster({
      issues: [makeIssue(), makeIssue()],
      issueCount: 2,
    });
    const manyIssues = makeCluster({
      issues: Array.from({ length: 25 }, (_, i) =>
        makeIssue({ number: i + 1 }),
      ),
      issueCount: 25,
    });

    const fewResult = scoreCluster(fewIssues, makeRepoMeta());
    const manyResult = scoreCluster(manyIssues, makeRepoMeta());

    expect(manyResult.breakdown.frequency).toBeGreaterThan(
      fewResult.breakdown.frequency,
    );
  });

  it("cluster with frustration keywords scores higher on frustration", () => {
    const calmCluster = makeCluster({
      issues: [makeIssue({ title: "Add dark mode support" })],
    });
    const frustratedCluster = makeCluster({
      issues: [
        makeIssue({ title: "App is broken and crashes on startup" }),
        makeIssue({
          title: "Cannot login, stuck on loading screen, not working",
        }),
        makeIssue({
          title: "Slow performance, impossible to use",
          reactions: { thumbsUp: 0, thumbsDown: 5, total: 5 },
        }),
      ],
      issueCount: 3,
    });

    const calmResult = scoreCluster(calmCluster, makeRepoMeta());
    const frustratedResult = scoreCluster(frustratedCluster, makeRepoMeta());

    expect(frustratedResult.breakdown.frustration).toBeGreaterThan(
      calmResult.breakdown.frustration,
    );
  });

  it("high-star repo scores higher on market size", () => {
    const cluster = makeCluster();
    const lowStars = makeRepoMeta({ stars: 100 });
    const highStars = makeRepoMeta({ stars: 60000 });

    const lowResult = scoreCluster(cluster, lowStars);
    const highResult = scoreCluster(cluster, highStars);

    expect(highResult.breakdown.marketSize).toBeGreaterThan(
      lowResult.breakdown.marketSize,
    );
  });

  it("all-open issues score 100 on gap", () => {
    const allOpen = makeCluster({
      issues: [
        makeIssue({ state: "open" }),
        makeIssue({ state: "open", number: 2 }),
        makeIssue({ state: "open", number: 3 }),
      ],
      issueCount: 3,
    });

    const result = scoreCluster(allOpen, makeRepoMeta());
    expect(result.breakdown.gap).toBe(100);
  });

  it("all-closed issues score 0 on gap", () => {
    const allClosed = makeCluster({
      issues: [
        makeIssue({ state: "closed" }),
        makeIssue({ state: "closed", number: 2 }),
      ],
      issueCount: 2,
    });

    const result = scoreCluster(allClosed, makeRepoMeta());
    expect(result.breakdown.gap).toBe(0);
  });
});

describe("scoreClusters", () => {
  it("sorts clusters by score descending", () => {
    const lowCluster = makeCluster({
      name: "low",
      issues: [makeIssue({ reactions: { thumbsUp: 0, thumbsDown: 0, total: 0 }, state: "closed" })],
      issueCount: 1,
    });
    const highCluster = makeCluster({
      name: "high",
      issues: Array.from({ length: 20 }, (_, i) =>
        makeIssue({
          number: i + 1,
          reactions: { thumbsUp: 10, thumbsDown: 0, total: 10 },
          state: "open",
        }),
      ),
      issueCount: 20,
    });

    const repo = makeRepoMeta({ stars: 40000 });
    const results = scoreClusters([lowCluster, highCluster], repo);

    expect(results.length).toBe(2);
    expect(results[0].name).toBe("high");
    expect(results[1].name).toBe("low");
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });
});
