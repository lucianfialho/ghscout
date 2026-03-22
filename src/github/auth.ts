import { execSync } from "node:child_process";

export async function resolveToken(): Promise<string | null> {
  // 1) GITHUB_TOKEN env var
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) {
    return envToken;
  }

  // 2) gh auth token subprocess
  try {
    const token = execSync("gh auth token", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (token) {
      return token;
    }
  } catch {
    // gh CLI not installed or not authenticated — fall through
  }

  // 3) null (unauthenticated)
  return null;
}

export function buildHeaders(
  token: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}
