const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
const sha = process.env.NEXT_PUBLIC_GIT_SHA || "dev";
const ref = process.env.NEXT_PUBLIC_GIT_REF || "dev";
const builtAt = process.env.NEXT_PUBLIC_BUILD_TIME || "";
const channel = process.env.NEXT_PUBLIC_APP_CHANNEL || "development";

const shortSha = sha === "dev" ? "dev" : sha.slice(0, 7);
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

export const revisionTooltip = [`${sha}`, `branch ${ref}`, pacificTime(builtAt)].join("\n");
export const revisionLabel = `v${shownVersion} · ${shortSha}`;
export const revisionMini = `v${version}`;
export const revisionBadge = badge;

export function AppRevision() {
  return (
    <p className="brand-rev" title={revisionTooltip}>
      <span>{revisionLabel}</span>
      {revisionBadge ? <span className="rev-badge">{revisionBadge}</span> : null}
    </p>
  );
}
