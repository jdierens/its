export type SyncLogEntity = "customer" | "vendor" | "connection" | "sync";
export type SyncLogDirection = "pull" | "push" | "oauth";
export type SyncLogStatus = "ok" | "error" | "in_flight";
export type SyncLogPhase = "in_flight" | "completed";
export type SyncLogDetail = Record<string, string | number | null>;

export type SyncLogWrite = {
  entity: SyncLogEntity;
  direction: SyncLogDirection;
  status: "ok" | "error";
  message: string;
  detail?: SyncLogDetail | null;
  startedAt?: string;
};

export type ChunkLogOpen = {
  entity: "customer" | "vendor";
  direction: "pull" | "push";
  message: string;
  detail?: SyncLogDetail | null;
  startedAt?: string;
};

const MESSAGE_LIMIT = 500;

export function clipSyncMessage(message: string): string {
  return message.slice(0, MESSAGE_LIMIT);
}

/** Insert for one finished event. `phase` is completed. The column default matches when the migration is applied. */
export function completedLogRow(entry: SyncLogWrite, now: string) {
  return {
    started_at: entry.startedAt ?? now,
    finished_at: now,
    entity: entry.entity,
    direction: entry.direction,
    status: entry.status,
    phase: "completed" as const,
    message: clipSyncMessage(entry.message),
    detail: entry.detail ?? null,
  };
}

/**
 * Insert for a customer or vendor chunk that is still reading QuickBooks.
 * `finished_at` stays empty until `completedLogPatch` updates this same row.
 */
export function inFlightLogRow(entry: ChunkLogOpen, now: string) {
  return {
    started_at: entry.startedAt ?? now,
    finished_at: null,
    entity: entry.entity,
    direction: entry.direction,
    status: "in_flight" as const,
    phase: "in_flight" as const,
    message: clipSyncMessage(entry.message),
    detail: entry.detail ?? null,
  };
}

/** Update payload. It does not include identity columns, so it cannot insert a second row. */
export function completedLogPatch(
  entry: { status: "ok" | "error"; message: string; detail?: SyncLogDetail | null },
  finishedAt: string,
) {
  return {
    finished_at: finishedAt,
    status: entry.status,
    phase: "completed" as const,
    message: clipSyncMessage(entry.message),
    detail: entry.detail ?? null,
  };
}

/** True when `phase` or `status = in_flight` is not in the database yet. */
export function chunkPhaseUnavailable(message: string): boolean {
  const names =
    /phase|qbo_sync_log_status_known|qbo_sync_log_phase_known|qbo_sync_log_in_flight_open/i.test(message);
  const reason = /schema cache|does not exist|could not find|column|check constraint|violates/i.test(message);
  return names && reason;
}

export function logPhaseLabel(entry: {
  phase?: string | null;
  status?: string | null;
  finishedAt?: string | null;
}): "In flight" | "Completed" {
  if (entry.phase === "in_flight" || entry.status === "in_flight") return "In flight";
  return "Completed";
}
