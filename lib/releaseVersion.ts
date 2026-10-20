export type Bump = "minor" | "patch";

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function applyBump(version: string, bump: Bump): string {
  const match = VERSION.exec(version);
  if (!match) throw new Error(`Version must look like 1.2.3, got ${version}.`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** First `bump: minor` or `bump: patch` line in a changes file. */
export function parseBump(source: string): Bump {
  const match = source.match(/^bump:\s*(minor|patch)\s*$/m);
  if (!match) throw new Error("A changes file needs a line that says bump: minor or bump: patch.");
  return match[1] as Bump;
}

/**
 * Sidebar version. `baseline` is package.json. Each changes file adds one bump.
 * Files apply in name order, so a dated prefix keeps the sequence stable.
 */
export function releaseVersion(baseline: string, fragments: { name: string; bump: Bump }[]): string {
  const ordered = [...fragments].sort((a, b) => a.name.localeCompare(b.name));
  return ordered.reduce((version, fragment) => applyBump(version, fragment.bump), baseline);
}
