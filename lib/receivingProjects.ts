/** How many distinct projects the receiving combobox offers before the clerk types. */
export const RECENT_PROJECT_LIMIT = 10;

/** Rows read per request while collecting distinct project names. */
export const PROJECT_SCAN_PAGE = 1000;

/**
 * Safety stop for a typed search.
 * One busy project can fill a page, so the scan keeps going until the names
 * fill up or a short page says the ledger has no more rows.
 */
export const PROJECT_SCAN_PAGES = 20;

/** Distinct names offered while a project code is being typed. */
export const PROJECT_MATCH_LIMIT = 80;

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

/**
 * Case-insensitive contains. A blank query leaves the list unchanged.
 * "AZ" matches AZSIM6930. The typed text is not required to be the whole code.
 */
export function filterRecentProjects(projects: string[], query: string): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return projects;
  return projects.filter((name) => name.toLocaleLowerCase().includes(needle));
}

/**
 * ILIKE pattern for a typed project code.
 * `%` and `_` are wildcards in the database, so they are not passed through.
 * A blank or wildcard-only query does not search.
 */
export function projectSearchPattern(query: string): string | null {
  const needle = query.trim().slice(0, 120).replace(/[%_\\]/g, "");
  if (!needle) return null;
  return `%${needle}%`;
}

/** A full page that has not filled `limit` still has older names behind it. */
export function projectScanFinished(
  names: readonly unknown[],
  page: readonly unknown[],
  limit: number,
  pageSize: number,
): boolean {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : PROJECT_SCAN_PAGE;
  return names.length >= cap || page.length < size;
}

/**
 * Newest-first pages become distinct project names.
 * A page that is shorter than `pageSize` ends the scan.
 * A full page does not: the next page can hold an older code.
 */
export function collectDistinctProjects(
  pages: readonly RecentProjectRow[][],
  limit = RECENT_PROJECT_LIMIT,
  pageSize = PROJECT_SCAN_PAGE,
): string[] {
  const rows: RecentProjectRow[] = [];
  for (const page of pages) {
    rows.push(...page);
    const names = distinctRecentProjects(rows, limit);
    if (projectScanFinished(names, page, limit, pageSize)) return names;
  }
  return distinctRecentProjects(rows, limit);
}

/** History matches first, then names already on the page, without the recent-list cap. */
export function projectChoices(matches: string[], recent: string[]): string[] {
  return distinctRecentProjects(
    [...matches, ...recent].map((project) => ({ project })),
    matches.length + recent.length,
  );
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
