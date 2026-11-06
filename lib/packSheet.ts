import { formatPickQty, omitPickTicketSku, pickSheetPlace } from "@/lib/pickSheet";

export type PackKind = "box" | "pallet";

export type PackAllocation = {
  lineNo: number;
  sku: string;
  picked: number;
  packed: number;
};

export type PackBinCheck = {
  number: number;
  kind: PackKind;
  weightLb: number | null;
  heightIn: number | null;
};

export type PackagingType = {
  id: string;
  name: string;
  kind: PackKind;
  lengthIn: number;
  widthIn: number;
  heightIn: number | null;
};

export type PackAssignment = {
  id: string;
  binId: string;
  binNumber: number;
  kind: PackKind;
  qty: number;
};

export type PackLine = {
  allocationId: string;
  lineNo: number;
  sku: string;
  name: string;
  plannedSku: string;
  replaced: boolean;
  picked: number;
  packed: number;
  assignments: PackAssignment[];
};

export type ShippingBin = {
  id: string;
  number: number;
  kind: PackKind;
  typeId: string | null;
  typeName: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number | null;
  weightLb: number | null;
};

export type PackSheetModel = {
  orderId: string;
  soNumber: number | null;
  status: string;
  /** When packing finished. Null until finish, including on a shipped order that is still being packed. */
  packedAt: string | null;
  /**
   * Server flag: bins and quantities can be saved.
   * An older sheet omits this and only a packing order is treated as open.
   * The sheet still offers corrections after finish. See packSheetEditable.
   */
  editable: boolean;
  customer: string;
  customerPo: string | null;
  pickStatus: "open" | "picked" | "short" | null;
  finishBlock: string | null;
  handoff: string | null;
  types: PackagingType[];
  bins: ShippingBin[];
  lines: PackLine[];
};

export type PackQueueRow = {
  orderId: string;
  soNumber: number;
  status: string;
  customer: string;
  customerPo: string | null;
  orderDate: string | null;
  pickStatus: string | null;
  picked: number;
  packed: number;
  bins: number;
};

export type ShipQueueRow = {
  orderId: string;
  soNumber: number;
  customer: string;
  customerPo: string | null;
  packedAt: string | null;
  bins: number;
};

/** Same stock rule as the pick ticket. Freight, fees, services, and item 4343 stay off the pack sheet. */
export function isPackLine(line: {
  lineKind: string;
  itemType: string | null;
  picked: number;
  sku?: string | null;
}): boolean {
  if (omitPickTicketSku(line.sku)) return false;
  if (pickSheetPlace(line) !== "pick") return false;
  return line.picked > 0;
}

export function formatPackQty(value: number): string {
  return formatPickQty(value);
}

export function shippingBinLabel(kind: PackKind, number: number): string {
  return `${kind === "pallet" ? "Pallet" : "Box"} ${number}`;
}

/** Quantity and bin stay in words so "Box 1" and qty 8 cannot read as box 18. */
export function packAssignmentLabel(kind: PackKind, binNumber: number, qty: number): string {
  return `${formatPackQty(qty)} in ${shippingBinLabel(kind, binNumber)}`;
}

export function formatInches(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatPackQty(value);
}

export function formatBinSize(bin: { lengthIn: number | null; widthIn: number | null; heightIn: number | null }): string {
  return `${formatInches(bin.lengthIn)} × ${formatInches(bin.widthIn)} × ${formatInches(bin.heightIn)} in`;
}

/** Room left in one bin. alreadyInBin is the quantity that bin already holds, so a replace can keep it. */
export function packRoom(picked: number, packed: number, alreadyInBin: number): number {
  if (![picked, packed, alreadyInBin].every((value) => Number.isFinite(value))) return 0;
  return Math.max(0, picked - packed + alreadyInBin);
}

/** Assign field before the packer types. One unit when the line still has room, never the remainder. */
export function defaultPackAssignQty(room: number): string {
  if (!Number.isFinite(room) || room < 1) return "";
  return "1";
}

/** Text Assign submits. Undefined means the field was left alone. An empty string was cleared on purpose. */
export function packAssignQtyText(typed: string | undefined, room: number): string {
  return typed ?? defaultPackAssignQty(room);
}

export function packQtyError(qty: number, room: number): string | null {
  if (!Number.isInteger(qty) || qty < 1) return "Enter a whole number of at least 1.";
  if (room < 1) return "That line is already packed.";
  if (qty > room) return `Only ${formatPackQty(room)} can go in that bin.`;
  return null;
}

export function parsePackQty(value: string, room: number): { ok: true; qty: number } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: "Enter a whole number of at least 1." };
  const qty = Number(trimmed);
  const message = packQtyError(qty, room);
  if (message) return { ok: false, message };
  return { ok: true, qty };
}

function roundMeasure(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseInches(
  value: string,
  label: string,
): { ok: true; inches: number } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { ok: false, message: `Enter ${label} in inches, up to two decimals.` };
  const inches = roundMeasure(Number(trimmed));
  if (inches <= 0) return { ok: false, message: `${label} has to be greater than zero.` };
  if (inches > 999) return { ok: false, message: `${label} is too large.` };
  return { ok: true, inches };
}

export function parsePackWeight(value: string): { ok: true; weight: number } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, message: "Enter a weight in pounds." };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { ok: false, message: "Enter a weight in pounds, up to two decimals." };
  const weight = roundMeasure(Number(trimmed));
  if (weight <= 0) return { ok: false, message: "Enter a weight greater than zero." };
  if (weight > 99999) return { ok: false, message: "That weight is too large." };
  return { ok: true, weight };
}

export function packagingTypeError(input: {
  name: string;
  kind: string;
  length: string;
  width: string;
  height: string;
}): string | null {
  const name = input.name.trim();
  if (!name) return "Name the packaging type.";
  if (name.length > 80) return "A packaging name is at most 80 characters.";
  if (input.kind !== "box" && input.kind !== "pallet") return "Choose a box or a pallet.";
  const length = parseInches(input.length, "a length");
  if (!length.ok) return length.message;
  const width = parseInches(input.width, "a width");
  if (!width.ok) return width.message;
  if (input.kind === "pallet") {
    if (input.height.trim()) return "A pallet height is entered when the bin is packed, not on the type.";
    return null;
  }
  if (!input.height.trim()) return "A box needs a height in inches.";
  const height = parseInches(input.height, "a height");
  if (!height.ok) return height.message;
  return null;
}

export function packagingTypeMeasures(input: {
  kind: string;
  length: string;
  width: string;
  height: string;
}): { lengthIn: number; widthIn: number; heightIn: number | null } | null {
  if (packagingTypeError({ name: "type", ...input })) return null;
  const length = parseInches(input.length, "a length");
  const width = parseInches(input.width, "a width");
  if (!length.ok || !width.ok) return null;
  if (input.kind === "pallet") return { lengthIn: length.inches, widthIn: width.inches, heightIn: null };
  const height = parseInches(input.height, "a height");
  if (!height.ok) return null;
  return { lengthIn: length.inches, widthIn: width.inches, heightIn: height.inches };
}

/**
 * Packing is finished only when every picked quantity is in a shipping bin
 * and every bin has a weight. A pallet also needs the height the operator entered.
 * Lines with nothing picked, and service lines, are not part of this check.
 */
export function packCompleteBlock(lines: readonly PackAllocation[], bins: readonly PackBinCheck[]): string | null {
  const stock = lines.filter((line) => line.picked > 0 || line.packed > 0);
  const picked = stock.reduce((sum, line) => sum + (line.picked > 0 ? line.picked : 0), 0);
  if (stock.length === 0 || picked <= 0) return "Nothing was picked, so there is nothing to pack.";
  if (bins.length === 0) return "Add a shipping bin before packing can be finished.";
  for (const line of stock) {
    const label = `Line ${line.lineNo} ${line.sku}`;
    if (line.packed > line.picked) return `${label} has more packed than picked.`;
    if (line.packed < line.picked) {
      return `${label} still has ${formatPackQty(line.picked - line.packed)} to pack.`;
    }
  }
  for (const bin of bins) {
    const label = shippingBinLabel(bin.kind, bin.number);
    if (bin.heightIn == null || bin.heightIn <= 0) return `${label} needs a height.`;
    if (bin.weightLb == null || bin.weightLb <= 0) return `${label} needs a weight.`;
  }
  return null;
}

/** Already shipped. Packing must not move this status. */
export function isShippedPackStatus(status: string): boolean {
  return status === "shipped" || status === "partially_shipped";
}

/** Shown while the packer is recording bins on an order that already shipped. */
export function packCatchUpNote(status: string): string | null {
  if (status === "shipped") {
    return "This order already shipped. Packing records the bins and leaves the ship record in place.";
  }
  if (status === "partially_shipped") {
    return "This order is partially shipped. Packing records the bins and leaves the ship record in place.";
  }
  return null;
}

/** Shown after finish when status was left shipped. */
export function packedAfterShipNote(status: string): string | null {
  if (status === "shipped") return "Packed. This order stays shipped.";
  if (status === "partially_shipped") return "Packed. This order stays partially shipped.";
  return null;
}

export const PACK_EDIT_MIGRATION = "supabase/migrations/20261106010000_pack_edit_after_finish.sql";

/**
 * Bins, weights, heights, and quantities stay editable after Finish.
 * Packing, packed, and a shipped catch-up can be corrected. Cancelled, invoiced,
 * and closed stay locked. A database that has not applied the migration still
 * says editable false; the sheet offers the correction and names that file if the save is refused.
 */
export function packSheetEditable(input: {
  canPack: boolean;
  status: string;
  packedAt: string | null;
  serverEditable: boolean;
  pickStatus: "open" | "picked" | "short" | null;
}): boolean {
  if (!input.canPack) return false;
  if (input.serverEditable) return true;
  if (input.pickStatus !== "picked" && input.pickStatus !== "short") return false;
  if (input.status === "packed") return true;
  if (isShippedPackStatus(input.status) && input.packedAt) return true;
  return false;
}

/** Finish is the open step. A complete finished pack hides it until a correction reopens the sheet. */
export function packFinishVisible(input: {
  status: string;
  packedAt: string | null;
  finishBlock: string | null;
}): boolean {
  if (input.status === "packing") return true;
  if (isShippedPackStatus(input.status) && !input.packedAt) return true;
  if (input.status === "packed" || isShippedPackStatus(input.status)) return Boolean(input.finishBlock);
  return false;
}

/** A finished pack refuses edits until that migration is applied. Say so next to the action. */
export function explainPackEdit(message: string): string {
  if (!message.includes("Packing is closed on this sales order.")) return message;
  return `${message} Apply ${PACK_EDIT_MIGRATION} before a finished pack can be corrected.`;
}

export function sheetPackProgress(lines: readonly { picked: number; packed: number }[]): { picked: number; packed: number } {
  return lines.reduce(
    (sum, line) => ({ picked: sum.picked + line.picked, packed: sum.packed + line.packed }),
    { picked: 0, packed: 0 },
  );
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

function qty(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) throw new Error("Unexpected pack sheet.");
  return numeric;
}

function qtyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  return qty(value);
}

function kind(value: unknown): PackKind {
  if (value === "box" || value === "pallet") return value;
  throw new Error("Unexpected pack sheet.");
}

function pickStatus(value: unknown): "open" | "picked" | "short" | null {
  if (value == null) return null;
  if (value === "open" || value === "picked" || value === "short") return value;
  throw new Error("Unexpected pack sheet.");
}

function types(value: unknown): PackagingType[] {
  if (!Array.isArray(value)) throw new Error("Unexpected pack sheet.");
  return value.map((entry) => {
    const row = record(entry);
    if (!row || typeof row.id !== "string" || typeof row.name !== "string") throw new Error("Unexpected pack sheet.");
    return {
      id: row.id,
      name: row.name,
      kind: kind(row.kind),
      lengthIn: qty(row.length_in),
      widthIn: qty(row.width_in),
      heightIn: qtyOrNull(row.height_in),
    };
  });
}

function bins(value: unknown): ShippingBin[] {
  if (!Array.isArray(value)) throw new Error("Unexpected pack sheet.");
  return value.map((entry) => {
    const row = record(entry);
    if (!row || typeof row.id !== "string" || typeof row.type_name !== "string") throw new Error("Unexpected pack sheet.");
    return {
      id: row.id,
      number: qty(row.number),
      kind: kind(row.kind),
      typeId: textOrNull(row.type_id),
      typeName: row.type_name,
      lengthIn: qty(row.length_in),
      widthIn: qty(row.width_in),
      heightIn: qtyOrNull(row.height_in),
      weightLb: qtyOrNull(row.weight_lb),
    };
  });
}

function assignments(value: unknown): PackAssignment[] {
  if (!Array.isArray(value)) throw new Error("Unexpected pack sheet.");
  return value.map((entry) => {
    const row = record(entry);
    if (!row || typeof row.id !== "string" || typeof row.bin_id !== "string") throw new Error("Unexpected pack sheet.");
    return {
      id: row.id,
      binId: row.bin_id,
      binNumber: qty(row.bin_number),
      kind: kind(row.kind),
      qty: qty(row.qty),
    };
  });
}

export function packSheetFromJson(value: unknown): PackSheetModel {
  const row = record(value);
  if (!row || typeof row.order_id !== "string" || !Array.isArray(row.lines) || !Array.isArray(row.bins) || !Array.isArray(row.types)) {
    throw new Error("Unexpected pack sheet.");
  }
  const soNumber = row.so_number == null ? null : qty(row.so_number);
  const status = text(row.status);
  return {
    orderId: row.order_id,
    soNumber,
    status,
    packedAt: Object.prototype.hasOwnProperty.call(row, "packed_at") ? textOrNull(row.packed_at) : null,
    editable: typeof row.editable === "boolean" ? row.editable : status === "packing",
    customer: text(row.customer),
    customerPo: textOrNull(row.customer_po),
    pickStatus: pickStatus(row.pick_status),
    finishBlock: textOrNull(row.finish_block),
    handoff: textOrNull(row.handoff),
    types: types(row.types),
    bins: bins(row.bins),
    lines: row.lines.map((entry) => {
      const line = record(entry);
      if (!line || typeof line.allocation_id !== "string" || typeof line.sku !== "string") {
        throw new Error("Unexpected pack sheet.");
      }
      return {
        allocationId: line.allocation_id,
        lineNo: qty(line.line_no),
        sku: line.sku,
        name: text(line.name),
        plannedSku: typeof line.planned_sku === "string" && line.planned_sku ? line.planned_sku : line.sku,
        replaced: line.replaced === true,
        picked: qty(line.picked),
        packed: qty(line.packed),
        assignments: assignments(line.assignments),
      };
    }),
  };
}

export function packagingTypesFromJson(value: unknown): PackagingType[] {
  return types(value);
}

export function packQueueFromJson(value: unknown): PackQueueRow[] {
  if (!Array.isArray(value)) throw new Error("Unexpected pack queue.");
  return value.map((entry) => {
    const row = record(entry);
    if (!row || typeof row.order_id !== "string") throw new Error("Unexpected pack queue.");
    const soNumber = qty(row.so_number);
    if (!Number.isSafeInteger(soNumber) || soNumber < 1) throw new Error("Unexpected pack queue.");
    return {
      orderId: row.order_id,
      soNumber,
      status: text(row.status),
      customer: text(row.customer),
      customerPo: textOrNull(row.customer_po),
      orderDate: textOrNull(row.order_date),
      pickStatus: textOrNull(row.pick_status),
      picked: qty(row.picked),
      packed: qty(row.packed),
      bins: qty(row.bins),
    };
  });
}

export function shipQueueFromJson(value: unknown): ShipQueueRow[] {
  if (!Array.isArray(value)) throw new Error("Unexpected ship queue.");
  return value.map((entry) => {
    const row = record(entry);
    if (!row || typeof row.order_id !== "string") throw new Error("Unexpected ship queue.");
    const soNumber = qty(row.so_number);
    if (!Number.isSafeInteger(soNumber) || soNumber < 1) throw new Error("Unexpected ship queue.");
    return {
      orderId: row.order_id,
      soNumber,
      customer: text(row.customer),
      customerPo: textOrNull(row.customer_po),
      packedAt: textOrNull(row.packed_at),
      bins: qty(row.bins),
    };
  });
}

/**
 * Shipped orders on Warehouse → Packing.
 * The pick is finished and packed_at is still empty. An open pick stays on the pick queue.
 */
export function shippedOrderNeedsPack(
  status: string,
  pickStatus: string | null,
  packedAt: string | null,
): boolean {
  if (!isShippedPackStatus(status)) return false;
  if (packedAt) return false;
  return pickStatus === "picked" || pickStatus === "short";
}

export function packQueueLabel(status: string): string {
  if (status === "shipped") return "Shipped";
  if (status === "partially_shipped") return "Partially shipped";
  if (status === "packing") return "Packing";
  if (status === "picking") return "Picked";
  if (status === "packed") return "Packed";
  return status;
}
