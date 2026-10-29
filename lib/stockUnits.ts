/**
 * Optional serial and country-of-origin capture for a receipt.
 * bin quantity stays authoritative. Each returned row becomes one stock unit.
 * A blank serial with a country still counts. A blank row does not.
 *
 * A spreadsheet paste splits on tabs and newlines, the same way a pick does.
 * A comma on a line is still that line's country. Pasting more than one serial
 * sets the quantity to that count. A quantity typed afterward stays in charge:
 * more serials than pieces is refused, and fewer leaves the rest as quantity only.
 */

import { errorText } from "@/lib/errors";
import { classifySerialPaste, parsePastedSerials } from "@/lib/pickSerialPaste";

export const RECEIVE_UNIT_ROW_CAP = 8;
export const SERIAL_MAX_LENGTH = 80;

export type UnitDraft = {
  serial: string;
  coo: string;
};

export type StockUnitInput = {
  serial: string | null;
  coo: string | null;
};

const BIN_CODE = /^\d{1,5}-[A-Za-z]$/;

export function normalizeSerial(value: string): string | null {
  const serial = value.trim();
  return serial ? serial : null;
}

export function normalizeCooCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return code ? code : null;
}

export function cooProblem(value: string): string | null {
  const code = normalizeCooCode(value);
  if (!code) return null;
  if (!/^[A-Z]{2,3}$/.test(code)) return "Use a 2- or 3-letter country code.";
  return null;
}

export function receiveUnitRows(qty: number): number {
  if (!Number.isInteger(qty) || qty < 1) return 0;
  if (qty > RECEIVE_UNIT_ROW_CAP) return 0;
  return qty;
}

/**
 * After a quantity leaves a bin, this many unit rows have to leave with it
 * so the units still in the bin do not exceed the quantity that remains.
 * Rows with no serial move first.
 */
export function unitsToRelocate(remainingQty: number, unitCount: number): number {
  if (!Number.isFinite(remainingQty) || !Number.isFinite(unitCount)) return 0;
  const remaining = Math.max(0, Math.trunc(remainingQty));
  const units = Math.max(0, Math.trunc(unitCount));
  return Math.max(0, units - remaining);
}

export function relocationOrder<T extends { serial: string | null; createdAt: string; id: string }>(
  units: readonly T[],
): T[] {
  return [...units].sort((left, right) => {
    const leftBlank = left.serial ? 1 : 0;
    const rightBlank = right.serial ? 1 : 0;
    if (leftBlank !== rightBlank) return leftBlank - rightBlank;
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
    if (left.id !== right.id) return left.id < right.id ? -1 : 1;
    return 0;
  });
}

export function resizeUnitRows(current: readonly UnitDraft[], count: number, coo: string, previousCoo: string): UnitDraft[] {
  const next = current.slice(0, count).map((row) => (row.coo === previousCoo ? { ...row, coo } : { ...row }));
  while (next.length < count) next.push({ serial: "", coo });
  return next;
}

function sameCoo(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

/**
 * One receipt's serials from a spreadsheet paste.
 * Newlines and tabs are cells. A comma on a line is "serial, country".
 * Empty cells are dropped. A line with no country uses the shared one.
 */
function pasteDrafts(paste: string, defaultCoo: string): UnitDraft[] {
  const drafts: UnitDraft[] = [];
  const text = paste.replace(/^\uFEFF/, "");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "").trim();
    if (!line) continue;
    const comma = line.indexOf(",");
    if (comma >= 0) {
      const serial = line.slice(0, comma).trim();
      const coo = line.slice(comma + 1).trim();
      if (!serial && !coo) continue;
      drafts.push({ serial, coo: coo || defaultCoo });
      continue;
    }
    for (const serial of parsePastedSerials(line)) drafts.push({ serial, coo: defaultCoo });
  }
  return drafts;
}

export type ReceiveSerialPastePlan =
  | { type: "default" }
  | { type: "ignore" }
  | { type: "fill"; serial: string; coo: string | null }
  | { type: "apply"; qty: string; rows: UnitDraft[]; paste: string };

/**
 * A column or row pasted onto the receive serial field.
 * More than one serial replaces the list and sets the quantity to that count.
 * One serial stays in the field. `coo` is set only when that one line named a country.
 */
export function applyReceiveSerialPaste(text: string, defaultCoo: string): ReceiveSerialPastePlan {
  const kind = classifySerialPaste(text);
  if (kind.type === "default" || kind.type === "ignore") return kind;
  const drafts = pasteDrafts(text, defaultCoo);
  if (drafts.length === 0) return { type: "ignore" };
  if (kind.type === "fill" || drafts.length === 1) {
    return {
      type: "fill",
      serial: drafts[0].serial,
      coo: text.includes(",") ? drafts[0].coo : null,
    };
  }
  const qty = String(drafts.length);
  if (drafts.length > RECEIVE_UNIT_ROW_CAP) {
    return { type: "apply", qty, rows: [], paste: pastedSerialText(drafts, defaultCoo) };
  }
  return { type: "apply", qty, rows: drafts, paste: "" };
}

function pastedSerialText(drafts: readonly UnitDraft[], defaultCoo: string): string {
  const sharedOnly = drafts.every((row) => row.serial.trim() && sameCoo(row.coo, defaultCoo));
  if (sharedOnly) return drafts.map((row) => row.serial.trim()).join("\n");
  return rowsToPaste(drafts);
}

const RECEIVE_SERIAL_SENTENCE =
  /That serial is already recorded for this item\.|That serial is already in this receipt\.|Enter at most one serial for each piece\.|A serial is at most 80 characters\.|That scan is the SKU, not a serial\.|That scan is a bin code, not a serial\.|Choose an item before entering serials\.|Enter at most 2000 serials on one receipt\.|Use a 2- or 3-letter country code\.|Serials must be a list\./;

/**
 * The sentence to show when a receipt's serials are refused.
 * Call this inside the server action and return the text. A thrown error is
 * replaced in production by the generic Server Components digest.
 */
export function receiveSerialFailure(error: unknown): string {
  const text = errorText(error);
  if (/stock_units_item_serial_idx/i.test(text)) return "That serial is already recorded for this item.";
  const known = text.match(RECEIVE_SERIAL_SENTENCE);
  if (known) return known[0];
  if (/Server Components render/i.test(text)) return "The receipt was not saved.";
  return text || "The receipt was not saved.";
}

function unitProblem(draft: UnitDraft, sku: string, seen: readonly string[]): string | null {
  const country = cooProblem(draft.coo);
  if (country) return country;
  const serial = normalizeSerial(draft.serial);
  if (!serial) return null;
  if (serial.length > SERIAL_MAX_LENGTH) return "A serial is at most 80 characters.";
  if (sku.trim() && serial.toUpperCase() === sku.trim().toUpperCase()) return "That scan is the SKU, not a serial.";
  if (BIN_CODE.test(serial)) return "That scan is a bin code, not a serial.";
  if (seen.some((row) => row.toLowerCase() === serial.toLowerCase())) {
    return "That serial is already in this receipt.";
  }
  return null;
}

export function collectReceiveUnits(input: {
  qty: number;
  sku: string;
  hasItem: boolean;
  rows: readonly UnitDraft[];
  paste: string;
  pasteCoo: string;
}): { ok: true; units: StockUnitInput[] } | { ok: false; message: string } {
  if (!Number.isInteger(input.qty) || input.qty < 1) return { ok: true, units: [] };
  const drafts =
    input.qty > RECEIVE_UNIT_ROW_CAP || input.paste.trim()
      ? pasteDrafts(input.paste, input.pasteCoo)
      : input.rows.slice(0, input.qty);
  const units: StockUnitInput[] = [];
  const seen: string[] = [];
  for (const draft of drafts) {
    const serial = normalizeSerial(draft.serial);
    const coo = normalizeCooCode(draft.coo);
    if (!serial && !coo) continue;
    const problem = unitProblem(draft, input.sku, seen);
    if (problem) return { ok: false, message: problem };
    if (!input.hasItem) return { ok: false, message: "Choose an item before entering serials." };
    if (serial) seen.push(serial);
    units.push({ serial, coo });
  }
  if (units.length > input.qty) return { ok: false, message: "Enter at most one serial for each piece." };
  return { ok: true, units };
}

export function rowsToPaste(rows: readonly UnitDraft[]): string {
  return rows
    .map((row) => {
      const serial = row.serial.trim();
      const coo = row.coo.trim();
      if (!serial && !coo) return "";
      if (serial && coo) return `${serial}, ${coo}`;
      return serial || coo;
    })
    .filter(Boolean)
    .join("\n");
}
