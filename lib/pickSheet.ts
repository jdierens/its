export type PickOwnership = "owned" | "consigned";

export type PickBin = {
  binId: string;
  reference: string;
  location: string | null;
  qty: number;
  project: string | null;
  ownership: PickOwnership;
};

export type PickSerial = {
  id: string;
  serial: string;
};

export type PickRecord = {
  id: string;
  fromBin: string | null;
  qty: number;
  project: string | null;
  ownership: PickOwnership | null;
  serials: PickSerial[];
};

export type PickLine = {
  allocationId: string;
  lineNo: number;
  sku: string;
  name: string;
  ordered: number;
  picked: number;
  short: boolean;
  bins: PickBin[];
  picks: PickRecord[];
};

export type PickSkip = {
  lineNo: number;
  sku: string | null;
  name: string | null;
  reason: string;
};

export type PickOrphan = PickRecord & {
  sku: string | null;
  name: string | null;
};

export type StagingStock = {
  reference: string;
  project: string | null;
  ownership: PickOwnership | null;
  qty: number;
  sku: string;
};

export type PickSheetModel = {
  orderId: string;
  soNumber: number | null;
  status: string;
  customer: string;
  customerPo: string | null;
  pickListId: string | null;
  pickStatus: "open" | "picked" | "short" | null;
  stagingBin: string | null;
  staging: StagingStock[];
  finishBlock: string | null;
  handoff: string | null;
  lines: PickLine[];
  skipped: PickSkip[];
  orphans: PickOrphan[];
};

export type PickQueueRow = {
  orderId: string;
  soNumber: number;
  status: string;
  customer: string;
  customerPo: string | null;
  orderDate: string | null;
  pickStatus: string | null;
  stagingBin: string | null;
  ordered: number;
  picked: number;
};

const STOCK_TYPES = new Set(["Product", "Kit/Package"]);

/** Product and kit package lines are picked. Freight, fee, service, and non-stock items are not. */
export function isStockPickLine(line: {
  lineKind: string;
  itemType: string | null;
  itemId: string | null;
}): boolean {
  if (line.lineKind !== "product" && line.lineKind !== "kit") return false;
  if (!line.itemId) return false;
  return line.itemType != null && STOCK_TYPES.has(line.itemType);
}

/**
 * Live stock keeps the project on the bin cycle. AZSIM6930 has no ownership
 * column, and that project is consigned. An explicit ownership wins.
 */
export function pickOwnership(project: string | null, ownership: string | null): PickOwnership {
  if (ownership === "owned" || ownership === "consigned") return ownership;
  return project && project.trim() ? "consigned" : "owned";
}

export function stagingLayer(
  project: string | null,
  ownership: string | null,
): { project: string | null; ownership: PickOwnership } {
  const trimmed = project?.trim() || null;
  return { project: trimmed, ownership: pickOwnership(trimmed, ownership) };
}

export function formatPickQty(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

export function lineRemaining(ordered: number, picked: number): number {
  if (!Number.isFinite(ordered) || !Number.isFinite(picked)) return 0;
  return Math.max(0, ordered - picked);
}

export function sheetProgress(lines: readonly { ordered: number; picked: number }[]): { ordered: number; picked: number } {
  return lines.reduce(
    (sum, line) => ({ ordered: sum.ordered + line.ordered, picked: sum.picked + line.picked }),
    { ordered: 0, picked: 0 },
  );
}

export function pickQtyError(qty: number, onHand: number, remaining: number): string | null {
  if (!Number.isInteger(qty) || qty < 1) return "Enter a whole number of at least 1.";
  if (qty > onHand) return `Only ${formatPickQty(onHand)} are in that bin.`;
  if (qty > remaining) return `Only ${formatPickQty(remaining)} still to pick.`;
  return null;
}

export function parsePickQty(
  value: string,
  onHand: number,
  remaining: number,
): { ok: true; qty: number } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: "Enter a whole number of at least 1." };
  const qty = Number(trimmed);
  const message = pickQtyError(qty, onHand, remaining);
  if (message) return { ok: false, message };
  return { ok: true, qty };
}

export type PickBinTarget = {
  allocationId: string;
  remaining: number;
  bins: readonly { binId: string; reference: string; qty: number }[];
};

/** A bin scan picks the first open line that holds that bin, up to what is still ordered. */
export function pickTargetForBin(
  lines: readonly PickBinTarget[],
  code: string,
): { allocationId: string; binId: string; qty: number } | null {
  const ref = code.trim().toUpperCase();
  if (!/^\d{1,5}-[A-Z]$/.test(ref)) return null;
  for (const line of lines) {
    if (line.remaining < 1) continue;
    const bin = line.bins.find((row) => row.reference.toUpperCase() === ref && row.qty > 0);
    if (!bin) continue;
    const qty = Math.min(Math.floor(bin.qty), Math.floor(line.remaining));
    if (qty < 1) continue;
    return { allocationId: line.allocationId, binId: bin.binId, qty };
  }
  return null;
}

export function serialProblem(input: { serial: string; sku: string; existing: readonly string[] }): string | null {
  const serial = input.serial.trim();
  if (!serial) return "Enter a serial.";
  if (serial.length > 80) return "A serial is at most 80 characters.";
  if (serial.toUpperCase() === input.sku.trim().toUpperCase()) return "That scan is the SKU, not a serial.";
  if (/^\d{1,5}-[A-Za-z]$/.test(serial)) return "That scan is a bin code, not a serial.";
  if (input.existing.some((row) => row.toLowerCase() === serial.toLowerCase())) {
    return "That serial is already recorded for this item.";
  }
  return null;
}

export function serialAttachError(input: {
  serial: string;
  sku: string;
  existing: readonly string[];
  attached: number;
  picked: number;
}): string | null {
  if (input.picked < 1) return "Pick a quantity before scanning a serial.";
  const problem = serialProblem(input);
  if (problem) return problem;
  if (input.attached >= input.picked) return "This pick already has a serial for each piece.";
  return null;
}

export function finishBlockMessage(
  lines: readonly { lineNo: number; sku: string; ordered: number; picked: number; short: boolean }[],
  orphans: number,
): string | null {
  if (orphans > 0) return "A pick is no longer on a line. Undo it before finishing.";
  for (const line of lines) {
    const label = `Line ${line.lineNo} ${line.sku}`;
    if (line.picked > line.ordered) return `${label} has more picked than ordered.`;
    if (line.picked < line.ordered && !line.short) return `${label} is short. Acknowledge the short before finishing.`;
  }
  return null;
}

export function pickFinishStatus(
  lines: readonly { lineNo: number; sku: string; ordered: number; picked: number; short: boolean }[],
  orphans: number,
): "picked" | "short" | null {
  if (lines.length === 0 || finishBlockMessage(lines, orphans)) return null;
  return lines.some((line) => line.picked < line.ordered) ? "short" : "picked";
}

export function pickQueueLabel(status: string, pickStatus: string | null): string {
  if (pickStatus === "open") return "Picking";
  if (pickStatus === "picked") return "Picked";
  if (pickStatus === "short") return "Short";
  if (status === "picking") return "Picking";
  if (status === "approved") return "Approved";
  return status;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const raw = text(value).trim();
  return raw || null;
}

function pickListStatus(value: unknown): "open" | "picked" | "short" | null {
  if (value == null) return null;
  if (value === "open" || value === "picked" || value === "short") return value;
  throw new Error("Unexpected pick sheet.");
}

function qty(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) throw new Error("Unexpected pick sheet.");
  return numeric;
}

function ownership(value: unknown, project: string | null): PickOwnership {
  if (value === "owned" || value === "consigned") return value;
  if (value == null) return pickOwnership(project, null);
  throw new Error("Unexpected pick sheet.");
}

function serials(value: unknown): PickSerial[] {
  if (!Array.isArray(value)) throw new Error("Unexpected pick sheet.");
  return value.map((entry) => {
    const row = record(entry);
    if (!row || typeof row.id !== "string" || typeof row.serial !== "string") throw new Error("Unexpected pick sheet.");
    return { id: row.id, serial: row.serial };
  });
}

function picks(value: unknown): PickRecord[] {
  if (!Array.isArray(value)) throw new Error("Unexpected pick sheet.");
  return value.map((entry) => {
    const row = record(entry);
    if (!row || typeof row.id !== "string") throw new Error("Unexpected pick sheet.");
    const project = textOrNull(row.project);
    return {
      id: row.id,
      fromBin: textOrNull(row.from_bin),
      qty: qty(row.qty),
      project,
      ownership: row.ownership == null ? null : ownership(row.ownership, project),
      serials: serials(row.serials),
    };
  });
}

function bins(value: unknown): PickBin[] {
  if (!Array.isArray(value)) throw new Error("Unexpected pick sheet.");
  return value.map((entry) => {
    const row = record(entry);
    if (!row || typeof row.bin_id !== "string" || typeof row.reference !== "string") {
      throw new Error("Unexpected pick sheet.");
    }
    const project = textOrNull(row.project);
    return {
      binId: row.bin_id,
      reference: row.reference,
      location: textOrNull(row.location),
      qty: qty(row.qty),
      project,
      ownership: ownership(row.ownership, project),
    };
  });
}

export function pickSheetFromJson(value: unknown): PickSheetModel {
  const row = record(value);
  if (!row || typeof row.order_id !== "string") throw new Error("Unexpected pick sheet.");
  const pickStatus = pickListStatus(row.pick_status);
  if (!Array.isArray(row.lines) || !Array.isArray(row.skipped) || !Array.isArray(row.orphans) || !Array.isArray(row.staging)) {
    throw new Error("Unexpected pick sheet.");
  }
  const soNumber = row.so_number == null ? null : qty(row.so_number);
  return {
    orderId: row.order_id,
    soNumber: soNumber == null ? null : soNumber,
    status: text(row.status),
    customer: text(row.customer),
    customerPo: textOrNull(row.customer_po),
    pickListId: textOrNull(row.pick_list_id),
    pickStatus,
    stagingBin: textOrNull(row.staging_bin),
    staging: row.staging.map((entry) => {
      const stock = record(entry);
      if (!stock || typeof stock.reference !== "string" || typeof stock.sku !== "string") {
        throw new Error("Unexpected pick sheet.");
      }
      const project = textOrNull(stock.project);
      return {
        reference: stock.reference,
        project,
        ownership: stock.ownership == null ? null : ownership(stock.ownership, project),
        qty: qty(stock.qty),
        sku: stock.sku,
      };
    }),
    finishBlock: textOrNull(row.finish_block),
    handoff: textOrNull(row.handoff),
    lines: row.lines.map((entry) => {
      const line = record(entry);
      if (!line || typeof line.allocation_id !== "string" || typeof line.sku !== "string") {
        throw new Error("Unexpected pick sheet.");
      }
      return {
        allocationId: line.allocation_id,
        lineNo: qty(line.line_no),
        sku: line.sku,
        name: text(line.name),
        ordered: qty(line.ordered),
        picked: qty(line.picked),
        short: line.short === true,
        bins: bins(line.bins),
        picks: picks(line.picks),
      };
    }),
    skipped: row.skipped.map((entry) => {
      const skip = record(entry);
      if (!skip) throw new Error("Unexpected pick sheet.");
      return {
        lineNo: qty(skip.line_no),
        sku: textOrNull(skip.sku),
        name: textOrNull(skip.name),
        reason: text(skip.reason),
      };
    }),
    orphans: row.orphans.map((entry) => {
      const parsed = picks([entry])[0];
      const extra = record(entry);
      return { ...parsed, sku: textOrNull(extra?.sku), name: textOrNull(extra?.name) };
    }),
  };
}

export function pickQueueFromJson(value: unknown): PickQueueRow[] {
  if (!Array.isArray(value)) throw new Error("Unexpected pick queue.");
  return value.map((entry) => {
    const row = record(entry);
    if (!row || typeof row.order_id !== "string") throw new Error("Unexpected pick queue.");
    const soNumber = qty(row.so_number);
    if (!Number.isSafeInteger(soNumber) || soNumber < 1) throw new Error("Unexpected pick queue.");
    return {
      orderId: row.order_id,
      soNumber,
      status: text(row.status),
      customer: text(row.customer),
      customerPo: textOrNull(row.customer_po),
      orderDate: textOrNull(row.order_date),
      pickStatus: textOrNull(row.pick_status),
      stagingBin: textOrNull(row.staging_bin),
      ordered: qty(row.ordered),
      picked: qty(row.picked),
    };
  });
}
