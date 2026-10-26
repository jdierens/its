import { distinctRecentProjects, filterRecentProjects } from "@/lib/receivingProjects";

/** Distinct originating systems offered in the receiving combobox. */
export const RECENT_ORIGIN_LIMIT = 40;

/** Newest receipts scanned so older systems still appear in the list. */
export const RECENT_ORIGIN_SCAN = 1000;

export type RecentOriginRow = {
  origin?: string | null;
  origin_description?: string | null;
};

/**
 * Newest-first rows become distinct originating systems.
 * Blanks are skipped. A later row with the same letters keeps the newer spelling.
 * The stored receipt text is not rewritten.
 */
export function distinctRecentOrigins(rows: RecentOriginRow[], limit = RECENT_ORIGIN_LIMIT): string[] {
  return distinctRecentProjects(
    rows.map((row) => ({ project: row.origin ?? row.origin_description })),
    limit,
  );
}

/** Case-insensitive contains. A blank query leaves the list unchanged. */
export function filterRecentOrigins(origins: string[], query: string): string[] {
  return filterRecentProjects(origins, query);
}
