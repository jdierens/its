/** Unit price keeps four decimals so an extension can be split back onto the unit. */
export const UNIT_DECIMALS = 4;
export const EXT_DECIMALS = 2;

const UNIT_MAX = 99999999.9999;
const EXT_MAX = 9999999999.99;
const QTY_MAX = 9999999999.99;

export function roundPlaces(amount: number, places: number): number {
  const factor = 10 ** places;
  const nudged = amount * factor + (amount >= 0 ? 1e-8 : -1e-8);
  return Math.round(nudged) / factor;
}

export function extensionFromUnit(qty: number, unitCost: number): number {
  return roundPlaces(qty * unitCost, EXT_DECIMALS);
}

export function unitFromExtension(qty: number, ext: number): number {
  return roundPlaces(ext / qty, UNIT_DECIMALS);
}

/** Half a cent, or half of the fourth decimal times the quantity, whichever is larger. */
export function pricesMatch(qty: number, unitCost: number, ext: number): boolean {
  if (!(qty > 0) || unitCost < 0 || ext < 0) return false;
  const tolerance = Math.max(0.005, qty * 0.00005);
  return Math.abs(qty * unitCost - ext) <= tolerance + 1e-8;
}

export function formatUnitPrice(amount: number): string {
  const rounded = roundPlaces(amount, UNIT_DECIMALS);
  const four = rounded.toFixed(UNIT_DECIMALS);
  if (four.endsWith("00")) return rounded.toFixed(2);
  return four.replace(/0+$/, "").replace(/\.$/, "");
}

export function formatExtension(amount: number): string {
  return roundPlaces(amount, EXT_DECIMALS).toFixed(2);
}

export function parseQty(value: string): number | null {
  return parseDecimal(value, 2, QTY_MAX);
}

export function parseUnitCost(value: string): number | null {
  return parseDecimal(value, UNIT_DECIMALS, UNIT_MAX);
}

export function parseExtension(value: string): number | null {
  return parseDecimal(value, EXT_DECIMALS, EXT_MAX);
}

/** Sales-order unit price. A leading minus is a discount or a fee. Purchase orders stay unsigned. */
export function parseSignedUnitCost(value: string): number | null {
  return parseSignedDecimal(value, UNIT_DECIMALS, UNIT_MAX);
}

/** Sales-order extension. A leading minus is a discount or a fee. Purchase orders stay unsigned. */
export function parseSignedExtension(value: string): number | null {
  return parseSignedDecimal(value, EXT_DECIMALS, EXT_MAX);
}

export type PriceEdit = "qty" | "unit" | "ext";

/** Recompute the other price. The field being typed is left as typed. */
export function syncLinePrices(input: {
  qty: string;
  unitCost: string;
  extPrice: string;
  edited: PriceEdit;
}): { unitCost: string; extPrice: string } {
  const qty = parseQty(input.qty);
  const unit = parseUnitCost(input.unitCost);
  const ext = parseExtension(input.extPrice);
  if (qty == null || qty <= 0) return { unitCost: input.unitCost, extPrice: input.extPrice };

  if (input.edited === "ext") {
    if (ext == null) return { unitCost: input.unitCost, extPrice: input.extPrice };
    return { unitCost: formatUnitPrice(unitFromExtension(qty, ext)), extPrice: input.extPrice };
  }
  if (input.edited === "unit") {
    if (unit == null) return { unitCost: input.unitCost, extPrice: input.extPrice };
    const nextExt = extensionFromUnit(qty, unit);
    if (nextExt > EXT_MAX) return { unitCost: input.unitCost, extPrice: input.extPrice };
    return { unitCost: input.unitCost, extPrice: formatExtension(nextExt) };
  }
  if (unit != null) {
    const nextExt = extensionFromUnit(qty, unit);
    if (nextExt > EXT_MAX) return { unitCost: input.unitCost, extPrice: input.extPrice };
    return { unitCost: input.unitCost, extPrice: formatExtension(nextExt) };
  }
  if (ext != null) return { unitCost: formatUnitPrice(unitFromExtension(qty, ext)), extPrice: input.extPrice };
  return { unitCost: input.unitCost, extPrice: input.extPrice };
}

function parseDecimal(value: string, places: number, max: number): number | null {
  return parseDecimalText(value, places, max, false);
}

function parseSignedDecimal(value: string, places: number, max: number): number | null {
  return parseDecimalText(value, places, max, true);
}

function parseDecimalText(value: string, places: number, max: number, signed: boolean): number | null {
  const trimmed = value.trim().replace(/[$,]/g, "");
  const pattern = signed ? `^-?\\d+(\\.\\d{1,${places}})?$` : `^\\d+(\\.\\d{1,${places}})?$`;
  if (!new RegExp(pattern).test(trimmed)) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || Math.abs(amount) > max) return null;
  if (!signed && amount < 0) return null;
  return amount;
}
