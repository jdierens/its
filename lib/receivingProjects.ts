/** How many distinct projects the receiving combobox offers. */
export const RECENT_PROJECT_LIMIT = 10;

/** Rows scanned per person so ten distinct names still surface after blank projects. */
export const RECENT_PROJECT_SCAN = 200;

export type RecentProjectRow = {
  project?: string | null;
};

/** localStorage key for one person on this device. A signed-in id wins over initials. */
export function recentProjectStorageKey(userId: string | null, initials: string): string {
  const who = (userId ?? "").trim() || (initials ?? "").trim().toUpperCase() || "OP";
  return `its.receiving.project.${who}`;
}

/** Newest-first rows become distinct project names, blanks skipped, newest spelling kept. */
export function distinctRecentProjects(
  rows: RecentProjectRow[],
  limit = RECENT_PROJECT_LIMIT,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : RECENT_PROJECT_LIMIT;
  for (const row of rows) {
    const name = String(row.project ?? "").trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= cap) break;
  }
  return names;
}

/** Case-insensitive contains. A blank query leaves the recent list unchanged. */
export function filterRecentProjects(projects: string[], query: string): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return projects;
  return projects.filter((name) => name.toLocaleLowerCase().includes(needle));
}

/**
 * A stored string, including an empty one, is what this device last had.
 * Missing storage falls back to the newest project on the server.
 */
export function projectToRestore(stored: string | null, latest: string | null): string {
  if (stored !== null) return stored;
  return String(latest ?? "").trim();
}

export function readStoredProject(storage: Pick<Storage, "getItem">, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredProject(storage: Pick<Storage, "setItem">, key: string, project: string): void {
  try {
    storage.setItem(key, project);
  } catch {
    // Private mode and blocked storage still leave the field editable.
  }
}
