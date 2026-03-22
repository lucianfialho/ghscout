import { describe, it, expect } from "vitest";
import { clusterIssues } from "./cluster.js";
import type { Issue } from "../github/types.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesPath = resolve(__dirname, "../../test/fixtures/sample-issues.json");
const sampleIssues: Issue[] = JSON.parse(readFileSync(fixturesPath, "utf-8"));

describe("clusterIssues", () => {
  it("returns empty array for empty input", () => {
    expect(clusterIssues([])).toEqual([]);
  });

  it("groups similar issues together (auth middleware issues in one cluster)", () => {
    const clusters = clusterIssues(sampleIssues);

    // Find the cluster that contains auth middleware issues
    const authCluster = clusters.find((c) =>
      c.issues.some((i) => i.number === 1) && c.issues.some((i) => i.number === 2),
    );

    expect(authCluster).toBeDefined();
    expect(authCluster!.issueCount).toBeGreaterThanOrEqual(4);

    // All 5 auth middleware issues should be in the same cluster
    const authIssueNumbers = [1, 2, 3, 4, 5];
    const clusterNumbers = authCluster!.issues.map((i) => i.number);
    for (const num of authIssueNumbers) {
      expect(clusterNumbers).toContain(num);
    }
  });

  it("cluster name is a representative keyword or bigram", () => {
    const clusters = clusterIssues(sampleIssues);

    // Auth cluster should have a name related to "auth" or "auth middleware"
    const authCluster = clusters.find((c) =>
      c.issues.some((i) => i.number === 1),
    );
    expect(authCluster).toBeDefined();
    expect(authCluster!.name).toMatch(/auth|middleware/i);

    // Dark mode cluster should reference "dark mode"
    const darkCluster = clusters.find((c) =>
      c.issues.some((i) => i.number === 6),
    );
    expect(darkCluster).toBeDefined();
    expect(darkCluster!.name).toMatch(/dark\s*mode/i);
  });

  it("merges small clusters (<2 issues) into 'other'", () => {
    const clusters = clusterIssues(sampleIssues);

    // There should be an "other" cluster for miscellaneous single-issue topics
    const otherCluster = clusters.find((c) => c.name === "other");
    expect(otherCluster).toBeDefined();
    expect(otherCluster!.issueCount).toBeGreaterThanOrEqual(2);

    // No cluster (except possibly "other") should have fewer than 2 issues
    for (const cluster of clusters) {
      if (cluster.name !== "other") {
        expect(cluster.issueCount).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("calculates totalReactions correctly", () => {
    const clusters = clusterIssues(sampleIssues);

    for (const cluster of clusters) {
      const expectedTotal = cluster.issues.reduce(
        (sum, issue) => sum + issue.reactions.total,
        0,
      );
      expect(cluster.totalReactions).toBe(expectedTotal);
    }
  });

  it("returns clusters sorted by issueCount descending", () => {
    const clusters = clusterIssues(sampleIssues);

    for (let i = 1; i < clusters.length; i++) {
      const prev = clusters[i - 1];
      const curr = clusters[i];
      if (prev.issueCount === curr.issueCount) {
        expect(prev.totalReactions).toBeGreaterThanOrEqual(curr.totalReactions);
      } else {
        expect(prev.issueCount).toBeGreaterThan(curr.issueCount);
      }
    }
  });

  it("collects common labels across the cluster", () => {
    const clusters = clusterIssues(sampleIssues);

    const darkCluster = clusters.find((c) =>
      c.issues.some((i) => i.number === 6),
    );
    expect(darkCluster).toBeDefined();
    // "dark-mode" label appears on most dark mode issues
    expect(darkCluster!.labels).toContain("dark-mode");
  });

  it("every issue appears in exactly one cluster", () => {
    const clusters = clusterIssues(sampleIssues);

    const allIssueNumbers = clusters.flatMap((c) =>
      c.issues.map((i) => i.number),
    );

    // No duplicates
    expect(new Set(allIssueNumbers).size).toBe(allIssueNumbers.length);

    // All issues accounted for
    expect(allIssueNumbers.length).toBe(sampleIssues.length);
  });

  it("handles single issue input by putting it in 'other'", () => {
    const single = [sampleIssues[0]];
    const clusters = clusterIssues(single);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].name).toBe("other");
    expect(clusters[0].issueCount).toBe(1);
  });
});
