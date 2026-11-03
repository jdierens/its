/**
 * On hand is `item_for_sale_qty`: the sum of `bin_contents.qty` on open bin
 * cycles. Damaged quantity is not included. Inventory search and picks use
 * that same for-sale quantity. `items.quantity` is not this number.
 */
export function onHandFromRpc(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const qty = Number(value);
    if (Number.isFinite(qty)) return Math.trunc(qty);
  }
  return 0;
}

/** One receive, put-away, move, or pick recorded for a SKU. */
export type ItemEntry = {
  id: string;
  occurredAt: string;
  initials: string;
  what: string;
  fromPlace: string;
  bin: string;
  qty: number | null;
};

export function stockRpcMissing(error: { code?: string; message?: string } | null): boolean {
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

export function itemEntriesFromJson(value: unknown): ItemEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = record(entry);
    if (!row) return [];
    const id = text(row.id).trim();
    if (!id) return [];
    const qty = row.qty == null || row.qty === "" ? null : Number(row.qty);
    return [{
      id,
      occurredAt: text(row.occurred_at),
      initials: text(row.initials),
      what: text(row.what),
      fromPlace: text(row.from_place),
      bin: text(row.bin),
      qty: qty != null && Number.isFinite(qty) ? qty : null,
    }];
  });
}
