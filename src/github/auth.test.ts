import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveToken, buildHeaders } from "./auth.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
const mockedExecSync = vi.mocked(execSync);

describe("resolveToken", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns GITHUB_TOKEN from env when set", async () => {
    vi.stubEnv("GITHUB_TOKEN", "env-token-123");
    const token = await resolveToken();
    expect(token).toBe("env-token-123");
  });

  it("falls back to gh auth token subprocess", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    mockedExecSync.mockReturnValue("gh-cli-token-456\n");
    const token = await resolveToken();
    expect(token).toBe("gh-cli-token-456");
    expect(mockedExecSync).toHaveBeenCalledWith("gh auth token", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  it("returns null when neither env nor gh available", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    mockedExecSync.mockImplementation(() => {
      throw new Error("command not found: gh");
    });
    const token = await resolveToken();
    expect(token).toBeNull();
  });
});

describe("buildHeaders", () => {
  it("includes Authorization when token provided", () => {
    const headers = buildHeaders("my-token");
    expect(headers).toEqual({
      Accept: "application/vnd.github.v3+json",
      Authorization: "Bearer my-token",
    });
  });

  it("works without token", () => {
    const headers = buildHeaders(null);
    expect(headers).toEqual({
      Accept: "application/vnd.github.v3+json",
    });
    expect(headers).not.toHaveProperty("Authorization");
  });
});
