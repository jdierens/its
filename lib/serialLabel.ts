import { labelQuantityCommit } from "@/lib/labelDesk";

/** DK-1202 die, landscape. The 100 mm side is the feed; the 62 mm side is the tape width. */
export const SERIAL_LABEL_WIDTH_MM = 100;
export const SERIAL_LABEL_HEIGHT_MM = 62;

/** Code 128 quiet zone on each side, in modules. */
export const SERIAL_QUIET_MODULES = 10;

/** Bars plus quiet zone stay inside the label after the side padding. */
export const SERIAL_BARCODE_MAX_MM = 90;

/** About two lines in the description column, then an ellipsis. */
export const SERIAL_DESCRIPTION_MAX = 72;

export const SERIAL_LIST_MAX = 30;

const DOT_PX = 96 / 300;

/**
 * Code 128 symbol width in modules, without the quiet zone.
 * Start, data, check digit, and the 13-module stop.
 */
export function code128SymbolModules(text: string): number {
  return text.length * 11 + 35;
}

export type SerialBarcodePlan = {
  dots: number;
  modulePx: number;
  quietPx: number;
  quietModules: number;
  heightPx: number;
  totalPx: number;
  fits: boolean;
};

/** Whole printer dots, at least 4, sized so the bars and quiet zones fit `targetPx`. */
export function serialBarcodePlan(serial: string, targetPx: number): SerialBarcodePlan {
  const modules = code128SymbolModules(serial) + SERIAL_QUIET_MODULES * 2;
  const heightPx = Math.round((22 * 96) / 25.4);
  let dots = 6;
  if (targetPx > 0) {
    dots = Math.floor(targetPx / modules / DOT_PX);
  }
  if (dots > 6) dots = 6;
  if (dots < 4) dots = 4;
  let modulePx = dots * DOT_PX;
  let totalPx = modulePx * modules;
  if (targetPx > 0 && totalPx > targetPx + 0.5) {
    modulePx = targetPx / modules;
    totalPx = targetPx;
    dots = modulePx / DOT_PX;
  }
  return {
    dots,
    modulePx,
    quietPx: modulePx * SERIAL_QUIET_MODULES,
    quietModules: SERIAL_QUIET_MODULES,
    heightPx,
    totalPx,
    fits: targetPx <= 0 || totalPx <= targetPx + 0.5,
  };
}

export function serialLabelDescription(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= SERIAL_DESCRIPTION_MAX) return text;
  return `${text.slice(0, SERIAL_DESCRIPTION_MAX - 1).trimEnd()}…`;
}

export function serialLabelQtyText(quantity: string): string {
  return `Qty ${labelQuantityCommit(quantity)}`;
}

/** A pipe would add a fifth field. Each value is stored without one. */
export function serialLabelField(value: string): string {
  return value.replaceAll("|", " ").replace(/\s+/g, " ").trim();
}

/**
 * Future QR text. Not printed yet.
 * Always four fields: SKU, item name, quantity number, serial.
 * A pipe in any value becomes a space, so the result splits into exactly four parts.
 */
export function serialLabelQrPayload(input: {
  sku: string;
  name: string;
  quantity: string;
  serial: string;
}): string {
  return [
    serialLabelField(input.sku),
    serialLabelField(input.name),
    serialLabelField(labelQuantityCommit(input.quantity)),
    serialLabelField(input.serial),
  ].join("|");
}

export function normalizeSerial(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 64);
}

export type SerialAddStatus = "added" | "empty" | "duplicate" | "full";

export function addSerial(
  list: readonly string[],
  raw: string,
): { list: string[]; status: SerialAddStatus } {
  const serial = normalizeSerial(raw);
  if (!serial) return { list: [...list], status: "empty" };
  if (list.some((row) => row.toLowerCase() === serial.toLowerCase())) {
    return { list: [...list], status: "duplicate" };
  }
  if (list.length >= SERIAL_LIST_MAX) return { list: [...list], status: "full" };
  return { list: [...list, serial], status: "added" };
}

/** The list, plus a serial still sitting in the field. */
export function serialsToPrint(list: readonly string[], pending: string): string[] {
  const draft = normalizeSerial(pending);
  if (!draft) return [...list];
  if (list.some((row) => row.toLowerCase() === draft.toLowerCase())) return [...list];
  return [...list, draft];
}

export function serialPrintProblem(input: { hasItem: boolean; serialCount: number }): string | null {
  if (!input.hasItem) return "Select an item before printing.";
  if (input.serialCount < 1) return "Enter a serial number before printing.";
  return null;
}
