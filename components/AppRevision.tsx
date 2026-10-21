const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
const sha = process.env.NEXT_PUBLIC_GIT_SHA || "dev";
const ref = process.env.NEXT_PUBLIC_GIT_REF || "dev";
const builtAt = process.env.NEXT_PUBLIC_BUILD_TIME || "";
const channel = process.env.NEXT_PUBLIC_APP_CHANNEL || "development";

const devBuild = channel !== "production" && channel !== "preview";
const shownVersion = devBuild ? `${version}-dev` : version;
const badge = channel === "production" ? null : channel === "preview" ? "preview" : "dev";

function pacificTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Build time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export const revisionBeside = `v${shownVersion}`;
export const revisionTooltip = [revisionBeside, badge, sha, `branch ${ref}`, pacificTime(builtAt)]
  .filter((line): line is string => Boolean(line))
  .join("\n");
