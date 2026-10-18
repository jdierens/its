import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

function gitValue(command: string): string | null {
  try {
    const value = execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version?: string };
const version = packageJson.version || "0.0.0";
const sha = process.env.VERCEL_GIT_COMMIT_SHA || gitValue("git rev-parse HEAD") || "dev";
const ref = process.env.VERCEL_GIT_COMMIT_REF || gitValue("git rev-parse --abbrev-ref HEAD") || "dev";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_GIT_SHA: sha,
    NEXT_PUBLIC_GIT_REF: ref,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_APP_CHANNEL: process.env.VERCEL_ENV || "development",
  },
};

export default nextConfig;
