import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  formatScanResult,
  type ScoredCluster,
  type OutputOptions,
} from "./formatters.js";

function makeClusters(count: number): ScoredCluster[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `cluster-${i + 1}`,
    issues: [
      {
        number: 1000 + i * 10,
        title: `Issue A in cluster ${i + 1}`,
        htmlUrl: `https://github.com/owner/repo/issues/${1000 + i * 10}`,
        reactions: { total: 50 - i * 5 },
        createdAt: "2025-06-15T00:00:00Z",
      },
      {
        number: 1001 + i * 10,
        title: `Issue B in cluster ${i + 1}`,
        htmlUrl: `https://github.com/owner/repo/issues/${1001 + i * 10}`,
        reactions: { total: 30 - i * 3 },
        createdAt: "2025-10-01T00:00:00Z",
      },
      {
        number: 1002 + i * 10,
        title: `Issue C in cluster ${i + 1}`,
        htmlUrl: `https://github.com/owner/repo/issues/${1002 + i * 10}`,
        reactions: { total: 10 },
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
    issueCount: 3,
    totalReactions: 90 - i * 8,
    labels: ["bug", "auth"],
    score: 92 - i * 20,
    breakdown: {
      demand: 88 - i * 5,
      frequency: 75 - i * 5,
      frustration: 60 - i * 5,
      marketSize: 95 - i * 5,
      gap: 80 - i * 5,
    },
  }));
}

describe("formatScanResult", () => {
  describe("json format", () => {
    it("outputs valid compact JSON", () => {
      const clusters = makeClusters(3);
      const result = formatScanResult(clusters, { format: "json" });
      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].name).toBe("cluster-1");
      expect(parsed[0].score).toBe(92);
      // Ensure it's compact (no extra whitespace)
      expect(result).not.toContain("\n");
    });

    it("respects top limit", () => {
      const clusters = makeClusters(5);
      const result = formatScanResult(clusters, { format: "json", top: 2 });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe("cluster-1");
      expect(parsed[1].name).toBe("cluster-2");
    });
  });

  describe("table format", () => {
    it("has correct columns and alignment", () => {
      const clusters = makeClusters(2);
      const result = formatScanResult(clusters, { format: "table" });
      const lines = result.split("\n");

      // Header line
      expect(lines[0]).toContain("#");
      expect(lines[0]).toContain("Score");
      expect(lines[0]).toContain("Cluster");
      expect(lines[0]).toContain("Issues");
      expect(lines[0]).toContain("Reactions");
      expect(lines[0]).toContain("Top Issue");

      // Separator line
      expect(lines[1]).toMatch(/^-+/);

      // Data rows
      expect(lines.length).toBe(4); // header + separator + 2 rows
      expect(lines[2]).toContain("1");
      expect(lines[2]).toContain("92");
      expect(lines[2]).toContain("cluster-1");
      expect(lines[3]).toContain("2");
      expect(lines[3]).toContain("72");
      expect(lines[3]).toContain("cluster-2");
    });

    it("shows truncated title in Top Issue column", () => {
      const clusters = makeClusters(1);
      const result = formatScanResult(clusters, { format: "table" });
      // Top issue by reactions is "Issue A in cluster 1" (50 reactions)
      expect(result).toContain("Issue A in cluster 1");
      // Should NOT contain full URL in table anymore
      expect(result).not.toContain("https://github.com/owner/repo/issues/");
    });

    it("truncates long titles to 30 chars in table", () => {
      const clusters = makeClusters(1);
      clusters[0].issues[0].title =
        "A very long title that should definitely be truncated";
      const result = formatScanResult(clusters, { format: "table" });
      expect(result).toContain("A very long title that should ...");
    });

    it("handles empty clusters", () => {
      const result = formatScanResult([], { format: "table" });
      const lines = result.split("\n");
      // Header + separator, no data rows
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain("Score");
    });
  });

  describe("pretty format", () => {
    let savedNoColor: string | undefined;

    beforeEach(() => {
      savedNoColor = process.env["NO_COLOR"];
      delete process.env["NO_COLOR"];
    });

    afterEach(() => {
      if (savedNoColor !== undefined) {
        process.env["NO_COLOR"] = savedNoColor;
      } else {
        delete process.env["NO_COLOR"];
      }
    });

    it("includes score and breakdown", () => {
      const clusters = makeClusters(1);
      const result = formatScanResult(clusters, { format: "pretty" });

      expect(result).toContain("[92/100]");
      expect(result).toContain("cluster-1");
      expect(result).toContain("Issues: 3");
      expect(result).toContain("Reactions: 90");
      expect(result).toContain("Demand: 88");
      expect(result).toContain("Frequency: 75");
      expect(result).toContain("Frustration: 60");
      expect(result).toContain("Market: 95");
      expect(result).toContain("Gap: 80");
      expect(result).toContain("Labels: bug, auth");
    });

    it("shows top 2 issue URLs by reactions", () => {
      const clusters = makeClusters(1);
      const result = formatScanResult(clusters, { format: "pretty" });
      // Top issue by reactions is number 1000 (total: 50), second is 1001 (total: 30)
      expect(result).toContain(
        "https://github.com/owner/repo/issues/1000"
      );
      expect(result).toContain(
        "https://github.com/owner/repo/issues/1001"
      );
      expect(result).toContain("(showing top 2 issues by reactions)");
    });

    it("shows issue titles with reaction count and age", () => {
      const clusters = makeClusters(1);
      const result = formatScanResult(clusters, { format: "pretty" });
      // Top issue: "Issue A in cluster 1" with 50 reactions
      expect(result).toContain("[50 👍] Issue A in cluster 1");
      // Second issue: "Issue B in cluster 1" with 30 reactions
      expect(result).toContain("[30 👍] Issue B in cluster 1");
      // Age should be present (ends with "d)")
      expect(result).toMatch(/\[\d+ 👍\] .+? \(\d+d\)/);
    });

    it("truncates long titles to 70 chars", () => {
      const clusters = makeClusters(1);
      clusters[0].issues[0].title =
        "This is a very long issue title that should be truncated because it exceeds seventy characters limit";
      const result = formatScanResult(clusters, { format: "pretty" });
      expect(result).toContain("This is a very long issue title that should be truncated because it ex...");
    });

    it("includes ANSI color codes when NO_COLOR is not set", () => {
      const clusters = makeClusters(1);
      const result = formatScanResult(clusters, { format: "pretty" });
      // Should contain ANSI escape codes
      expect(result).toContain("\x1b[");
    });
  });

  describe("NO_COLOR env", () => {
    let savedNoColor: string | undefined;

    beforeEach(() => {
      savedNoColor = process.env["NO_COLOR"];
    });

    afterEach(() => {
      if (savedNoColor !== undefined) {
        process.env["NO_COLOR"] = savedNoColor;
      } else {
        delete process.env["NO_COLOR"];
      }
    });

    it("removes ANSI codes when NO_COLOR is set", () => {
      process.env["NO_COLOR"] = "1";
      const clusters = makeClusters(1);
      const result = formatScanResult(clusters, { format: "pretty" });
      // Should NOT contain any ANSI escape codes
      expect(result).not.toContain("\x1b[");
      // But should still have content
      expect(result).toContain("[92/100]");
      expect(result).toContain("cluster-1");
      expect(result).toContain("Demand: 88");
    });
  });
});
