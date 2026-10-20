import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
import { parseBump, releaseVersion } from "./lib/releaseVersion";

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
const baseline = packageJson.version || "0.0.0";
const changesDir = join(process.cwd(), "changes");
const fragments = readdirSync(changesDir)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .map((name) => ({ name, bump: parseBump(readFileSync(join(changesDir, name), "utf8")) }));
const version = releaseVersion(baseline, fragments);
const sha = process.env.VERCEL_GIT_COMMIT_SHA || gitValue("git rev-parse HEAD") || "dev";
const ref = process.env.VERCEL_GIT_COMMIT_REF || gitValue("git rev-parse --abbrev-ref HEAD") || "dev";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_GIT_SHA: sha,
    NEXT_PUBLIC_GIT_REF: ref,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_APP_CHANNEL: process.env.VERCEL_ENV || "development",
    NEXT_PUBLIC_AUTH_REQUIRED: process.env.AUTH_REQUIRED === "true" ? "true" : "",
  },
};

export default nextConfig;
