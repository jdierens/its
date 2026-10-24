export type MoveChild = {
  id: string;
  reference: string;
  type: string;
  label: string;
  boxes: number;
  items: number;
};

export type MoveItem = {
  itemId: string;
  sku: string;
  name: string;
  qty: number;
};

export type MovePlace =
  | {
      kind: "bin";
      code: string;
      path: string;
      place: string;
      bin: { id: string; reference: string; type: string; label: string; boxes: number; items: number };
      children: MoveChild[];
      items: MoveItem[];
    }
  | {
      kind: "location";
      code: string;
      path: string;
      place: string;
      children: MoveChild[];
      items: MoveItem[];
    }
  | { kind: "missing_bin"; code: string; type: string; message: string }
  | { kind: "unknown"; code: string; message: string };

export type MovePreview = {
  ok: boolean;
  message: string | null;
  summary: string | null;
};

export type RecentMove = {
  id: string;
  occurredAt: string;
  initials: string;
  what: string;
  fromPlace: string;
  toPlace: string;
  qty: number | null;
};

export type MoveResult = {
  summary: string;
  requestId: string;
};

const BIN_CODE = /^\d{1,5}-[A-Z]$/;

export function isBinCode(value: string): boolean {
  return BIN_CODE.test(value.trim().toUpperCase());
}

export function targetFields(code: string): { targetBin: string | null; targetLocation: string | null } {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { targetBin: null, targetLocation: null };
  if (isBinCode(trimmed)) return { targetBin: trimmed, targetLocation: null };
  return { targetBin: null, targetLocation: trimmed };
}

export function parseMoveQty(value: string, onHand: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < 1 || qty > 1000000 || qty > onHand) return null;
  return qty;
}

export function formatMoveWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function moveMigrationMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message ?? "");
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function child(value: unknown): MoveChild | null {
  const row = record(value);
  if (!row || typeof row.reference !== "string") return null;
  return {
    id: text(row.id),
    reference: row.reference,
    type: text(row.type),
    label: text(row.label) || row.reference,
    boxes: Number(row.boxes ?? 0),
    items: Number(row.items ?? 0),
  };
}

function item(value: unknown): MoveItem | null {
  const row = record(value);
  if (!row || typeof row.item_id !== "string") return null;
  const qty = Number(row.qty);
  if (!Number.isInteger(qty)) return null;
  return { itemId: row.item_id, sku: text(row.sku), name: text(row.name), qty };
}

export function movePlaceFromJson(value: unknown): MovePlace {
  const row = record(value);
  if (!row) throw new Error("Unexpected place.");
  const kind = text(row.kind);
  if (kind === "missing_bin") {
    return { kind, code: text(row.code), type: text(row.type), message: text(row.message) };
  }
  if (kind === "unknown") {
    return { kind, code: text(row.code), message: text(row.message) };
  }
  const children = Array.isArray(row.children) ? row.children.flatMap((entry) => {
    const parsed = child(entry);
    return parsed ? [parsed] : [];
  }) : [];
  const items = Array.isArray(row.items) ? row.items.flatMap((entry) => {
    const parsed = item(entry);
    return parsed ? [parsed] : [];
  }) : [];
  if (kind === "location") {
    return { kind, code: text(row.code), path: text(row.path), place: text(row.place), children, items };
  }
  const bin = record(row.bin);
  if (kind !== "bin" || !bin) throw new Error("Unexpected place.");
  return {
    kind,
    code: text(row.code),
    path: text(row.path),
    place: text(row.place),
    bin: {
      id: text(bin.id),
      reference: text(bin.reference),
      type: text(bin.type),
      label: text(bin.label),
      boxes: Number(bin.boxes ?? 0),
      items: Number(bin.items ?? 0),
    },
    children,
    items,
  };
}

export function movePreviewFromJson(value: unknown): MovePreview {
  const row = record(value);
  if (!row) throw new Error("Unexpected move.");
  return {
    ok: row.ok === true,
    message: typeof row.message === "string" ? row.message : null,
    summary: typeof row.summary === "string" ? row.summary : null,
  };
}

export function recentMovesFromJson(value: unknown): RecentMove[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = record(entry);
    if (!row) return [];
    const qty = row.qty == null ? null : Number(row.qty);
    return [{
      id: text(row.id),
      occurredAt: text(row.occurred_at),
      initials: text(row.initials),
      what: text(row.what),
      fromPlace: text(row.from_place),
      toPlace: text(row.to_place),
      qty: qty != null && Number.isFinite(qty) ? qty : null,
    }];
  });
}

export function moveSummaryFromJson(value: unknown): string {
  const row = record(value);
  const summary = row && typeof row.summary === "string" ? row.summary.trim() : "";
  if (!summary) throw new Error("The move was not saved.");
  return summary;
}
