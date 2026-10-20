import { RECONNECT_MESSAGE } from "@/lib/qbo/messages";
import { formatEntityResult, type EntityCounts, type SyncDirection, type SyncEntity } from "@/lib/qbo/syncOptions";

export const PAGE_SIZE = 100;
export const PAGES_PER_CHUNK = 2;
export const CDC_PAGE = 1000;

export type SyncChunk = EntityCounts & {
  entity: SyncEntity;
  done: boolean;
  stopped: boolean;
  position: number | null;
  total: number | null;
};

export function listQuery(name: "Customer" | "Vendor", start: number): string {
  return `select * from ${name} where Active in (true, false) orderby Id startposition ${start} maxresults ${PAGE_SIZE}`;
}

export function countQuery(name: "Customer" | "Vendor"): string {
  return `select count(*) from ${name} where Active in (true, false)`;
}

export function pageCompletesList(received: number): boolean {
  return received < PAGE_SIZE;
}

export function nextStart(start: number, received: number): number {
  return start + received;
}

export function recordsReached(start: number, received: number): number {
  if (received <= 0) return Math.max(0, start - 1);
  return start + received - 1;
}

export function addCounts(left: EntityCounts, right: EntityCounts): EntityCounts {
  return {
    created: left.created + right.created,
    updated: left.updated + right.updated,
    conflicts: left.conflicts + right.conflicts,
    errors: left.errors + right.errors,
  };
}

export function formatPullProgress(entity: SyncEntity, position: number, total: number | null): string {
  const label = entity === "customer" ? "Customers" : "Vendors";
  const seen = position.toLocaleString("en-US");
  const all = total === null ? "…" : total.toLocaleString("en-US");
  return `${label} ${seen} / ${all}`;
}

export function chunkLine(chunk: SyncChunk): string {
  if (!chunk.done && chunk.position !== null) return formatPullProgress(chunk.entity, chunk.position, chunk.total);
  if (!chunk.done) return chunk.entity === "customer" ? "Customers: still reading changes" : "Vendors: still reading changes";
  return "";
}

export function readTotalCount(payload: Record<string, unknown>): number | null {
  const response = payload.QueryResponse;
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;
  const total = (response as Record<string, unknown>).totalCount;
  if (typeof total === "number" && Number.isFinite(total) && total >= 0) return total;
  if (typeof total === "string" && /^\d+$/.test(total)) return Number(total);
  return null;
}

export function readPullCounts(value: unknown): EntityCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const created = numberField(record.created);
  const updated = numberField(record.updated);
  const conflicts = numberField(record.conflicts);
  const errors = numberField(record.errors);
  if (created === null || updated === null || conflicts === null || errors === null) return null;
  return { created, updated, conflicts, errors };
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

type SyncBody = {
  entities?: SyncChunk[];
  message?: string;
};

export type SyncPost = (body: {
  entities: SyncEntity[];
  direction: SyncDirection;
  full: boolean;
}) => Promise<{ ok: boolean; status: number; body: SyncBody }>;

export async function runSyncRequests(input: {
  entities: SyncEntity[];
  direction: SyncDirection;
  full: boolean;
  post: SyncPost;
  onProgress: (lines: string[]) => void;
}): Promise<{ ok: boolean; message: string; lines: string[] }> {
  const summaries: string[] = [];
  if (input.direction !== "pull") {
    const pushed = await postChunk(input.post, {
      entities: input.entities,
      direction: "push",
      full: input.full,
    });
    if (!pushed.ok) return { ok: false, message: pushed.message, lines: summaries };
    summaries.push(...pushed.lines);
    input.onProgress([...summaries]);
  }
  if (input.direction === "push") return { ok: true, message: summaries.join(" "), lines: summaries };

  for (const entity of input.entities) {
    let lastPosition: number | null = null;
    let stalled = 0;
    for (let guard = 0; guard < 1000; guard += 1) {
      const pulled = await postChunk(input.post, { entities: [entity], direction: "pull", full: input.full });
      if (!pulled.ok) return { ok: false, message: pulled.message, lines: [...summaries, ...pulled.lines] };
      const chunk = pulled.chunks.find((item) => item.entity === entity) ?? pulled.chunks[0];
      if (!chunk) return { ok: false, message: pulled.message || "Sync did not report a result.", lines: summaries };
      const line = chunkLine(chunk);
      input.onProgress([...summaries, line || pulled.lines[0] || ""]);
      if (chunk.stopped) {
        return { ok: false, message: pulled.message || line || "Sync failed. Run it again to continue.", lines: [...summaries, line] };
      }
      if (chunk.done) {
        summaries.push(formatEntityResult(entity, chunk));
        input.onProgress([...summaries]);
        break;
      }
      if (chunk.position !== null && chunk.position === lastPosition) {
        stalled += 1;
        if (stalled >= 2) {
          return {
            ok: false,
            message: `${line}. Sync did not advance. Run it again to continue.`,
            lines: [...summaries, line],
          };
        }
      } else {
        stalled = 0;
        lastPosition = chunk.position;
      }
      if (guard === 999) {
        return { ok: false, message: "Sync stopped after 1,000 passes. Run it again to continue.", lines: summaries };
      }
    }
  }
  return { ok: true, message: summaries.join(" "), lines: summaries };
}

async function postChunk(
  post: SyncPost,
  body: { entities: SyncEntity[]; direction: SyncDirection; full: boolean },
): Promise<{ ok: boolean; message: string; lines: string[]; chunks: SyncChunk[] }> {
  let lastMessage = "Sync failed.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: { ok: boolean; status: number; body: SyncBody };
    try {
      response = await post(body);
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "Sync failed.";
      continue;
    }
    const message = response.body.message || lastMessage;
    if (!response.ok && retryable(response.status)) {
      lastMessage = message;
      continue;
    }
    const chunks = response.body.entities ?? [];
    const lines = chunks
      .map((chunk) => (chunk.done ? formatEntityResult(chunk.entity, chunk) : chunkLine(chunk)))
      .filter((line) => line !== "");
    if (message === RECONNECT_MESSAGE) return { ok: false, message, lines, chunks };
    if (!response.ok) return { ok: false, message, lines, chunks };
    return { ok: true, message, lines, chunks };
  }
  return { ok: false, message: `${lastMessage} Run sync again to continue from the last saved page.`, lines: [], chunks: [] };
}

function retryable(status: number): boolean {
  return status === 408 || status === 409 || status === 502 || status === 503 || status === 504;
}
