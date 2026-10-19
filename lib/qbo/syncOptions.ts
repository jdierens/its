export type SyncEntity = "customer" | "vendor";
export type SyncDirection = "pull" | "push" | "both";

export type SyncOptions = {
  entities: SyncEntity[];
  direction: SyncDirection;
  full: boolean;
};

export type EntityCounts = {
  created: number;
  updated: number;
  conflicts: number;
  errors: number;
};

const ENTITIES = new Set<SyncEntity>(["customer", "vendor"]);
const DIRECTIONS = new Set<SyncDirection>(["pull", "push", "both"]);

export function parseSyncRequest(body: unknown): { ok: true; value: SyncOptions } | { ok: false; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Send entities, direction, and full." };
  }
  const record = body as { entities?: unknown; direction?: unknown; full?: unknown };
  if (!Array.isArray(record.entities) || record.entities.length === 0) {
    return { ok: false, message: "Select at least one of customer or vendor." };
  }
  const entities: SyncEntity[] = [];
  for (const entry of record.entities) {
    if (typeof entry !== "string" || !ENTITIES.has(entry as SyncEntity)) {
      return { ok: false, message: "Entities must be customer, vendor, or both." };
    }
    const entity = entry as SyncEntity;
    if (entities.includes(entity)) return { ok: false, message: "List each entity once." };
    entities.push(entity);
  }
  if (typeof record.direction !== "string" || !DIRECTIONS.has(record.direction as SyncDirection)) {
    return { ok: false, message: "Direction must be pull, push, or both." };
  }
  if (typeof record.full !== "boolean") {
    return { ok: false, message: "Full must be true or false." };
  }
  return { ok: true, value: { entities, direction: record.direction as SyncDirection, full: record.full } };
}

function plural(count: number, singular: string, pluralLabel: string): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

export function formatEntityResult(entity: SyncEntity, counts: EntityCounts): string {
  const label = entity === "customer" ? "Customers" : "Vendors";
  const conflicts = counts.conflicts > 0 ? `, ${plural(counts.conflicts, "conflict", "conflicts")}` : "";
  return `${label}: ${counts.created} new, ${counts.updated} updated${conflicts}, ${plural(counts.errors, "error", "errors")}`;
}

export function emptyCounts(): EntityCounts {
  return { created: 0, updated: 0, conflicts: 0, errors: 0 };
}
