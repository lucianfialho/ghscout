import { describe, it, expect } from "vitest";
import { detectRejectedDemand, detectWorkarounds } from "./signals.js";
import type { Pull, Issue } from "../github/types.js";

function makePull(overrides: Partial<Pull> = {}): Pull {
  return {
    number: 1,
    title: "Add dark mode",
    merged: false,
    mergedAt: null,
    reactions: { thumbsUp: 5, thumbsDown: 0, total: 5 },
    htmlUrl: "https://github.com/test/repo/pull/1",
    user: "alice",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    number: 1,
    title: "Feature request",
    body: "Some body text",
    labels: [],
    reactions: { thumbsUp: 2, thumbsDown: 0, total: 2 },
    commentsCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
    htmlUrl: "https://github.com/test/repo/issues/1",
    user: "bob",
    state: "open",
    ...overrides,
  };
}

describe("detectRejectedDemand", () => {
  it("finds closed-not-merged PRs with 3+ thumbsUp", () => {
    const pulls = [
      makePull({ number: 1, merged: false, reactions: { thumbsUp: 5, thumbsDown: 0, total: 5 } }),
    ];
    const result = detectRejectedDemand(pulls);
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(1);
  });

  it("ignores merged PRs", () => {
    const pulls = [
      makePull({ merged: true, mergedAt: "2026-01-02T00:00:00Z", reactions: { thumbsUp: 10, thumbsDown: 0, total: 10 } }),
    ];
    const result = detectRejectedDemand(pulls);
    expect(result).toHaveLength(0);
  });

  it("ignores PRs with <3 thumbsUp", () => {
    const pulls = [
      makePull({ reactions: { thumbsUp: 2, thumbsDown: 0, total: 2 } }),
    ];
    const result = detectRejectedDemand(pulls);
    expect(result).toHaveLength(0);
  });

  it("returns sorted by thumbsUp descending", () => {
    const pulls = [
      makePull({ number: 1, reactions: { thumbsUp: 3, thumbsDown: 0, total: 3 } }),
      makePull({ number: 2, reactions: { thumbsUp: 10, thumbsDown: 0, total: 10 } }),
      makePull({ number: 3, reactions: { thumbsUp: 5, thumbsDown: 0, total: 5 } }),
    ];
    const result = detectRejectedDemand(pulls);
    expect(result.map((r) => r.number)).toEqual([2, 3, 1]);
  });
});

describe("detectWorkarounds", () => {
  it("finds code blocks in body", () => {
    const issues = [
      makeIssue({ body: "Workaround:\n```js\nconsole.log('hi');\n```" }),
    ];
    const result = detectWorkarounds(issues);
    expect(result).toHaveLength(1);
    expect(result[0].signals).toContain("code block");
  });

  it("finds npm install references", () => {
    const issues = [
      makeIssue({ body: "I used npm install lodash as a workaround" }),
    ];
    const result = detectWorkarounds(issues);
    expect(result).toHaveLength(1);
    expect(result[0].signals).toContain("npm package: lodash");
  });

  it("finds npm i shorthand references", () => {
    const issues = [
      makeIssue({ body: "Try npm i @scope/pkg to fix it" }),
    ];
    const result = detectWorkarounds(issues);
    expect(result).toHaveLength(1);
    expect(result[0].signals).toContain("npm package: @scope/pkg");
  });

  it("finds yarn add references", () => {
    const issues = [
      makeIssue({ body: "Use yarn add react-query" }),
    ];
    const result = detectWorkarounds(issues);
    expect(result).toHaveLength(1);
    expect(result[0].signals).toContain("yarn package: react-query");
  });

  it("finds pnpm add references", () => {
    const issues = [
      makeIssue({ body: "Run pnpm add zod" }),
    ];
    const result = detectWorkarounds(issues);
    expect(result).toHaveLength(1);
    expect(result[0].signals).toContain("pnpm package: zod");
  });

  it("returns empty when no signals found", () => {
    const issues = [
      makeIssue({ body: "This is just a plain feature request with no workarounds." }),
    ];
    const result = detectWorkarounds(issues);
    expect(result).toHaveLength(0);
  });

  it("handles null/empty body", () => {
    const issues = [
      makeIssue({ body: "" }),
      makeIssue({ body: null as unknown as string }),
    ];
    const result = detectWorkarounds(issues);
    expect(result).toHaveLength(0);
  });

  it("detects multiple signals in one issue", () => {
    const issues = [
      makeIssue({
        body: "Workaround:\n```bash\nnpm install lodash\n```\nAlso try yarn add underscore",
      }),
    ];
    const result = detectWorkarounds(issues);
    expect(result).toHaveLength(1);
    expect(result[0].signals).toContain("code block");
    expect(result[0].signals).toContain("npm package: lodash");
    expect(result[0].signals).toContain("yarn package: underscore");
  });
});
