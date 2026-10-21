import {
  extensionFromUnit,
  formatExtension,
  formatUnitPrice,
  parseExtension,
  parseQty,
  parseUnitCost,
  pricesMatch,
  unitFromExtension,
} from "@/lib/poLineMoney";

export type ImportPreviewRow = {
  rowNumber: number;
  itemId: string;
  itemSku: string;
  itemName: string;
  description: string;
  qty: string;
  unit: string;
  unitCost: string;
  extPrice: string;
  level: "ok" | "warning" | "error";
  message: string | null;
};

export type ImportPreview = {
  error: string | null;
  rows: ImportPreviewRow[];
};

export type ItemMatch = {
  id: string;
  sku: string;
  name: string;
  description: string;
};

const MAX_ROWS = 100;

const ALIASES: Record<"sku" | "qty" | "unit" | "unitPrice" | "extPrice" | "description", string[]> = {
  sku: ["item id", "itemid", "sku", "item sku", "item number", "item no", "item #", "id"],
  qty: ["qty", "quantity", "qty ordered", "order qty"],
  unit: ["unit", "uom", "units"],
  unitPrice: ["unit price", "unit cost", "price", "cost"],
  extPrice: ["ext price", "extended price", "extension", "ext", "line total", "amount"],
  description: ["description", "item description", "desc"],
};

export function mapImportSheet(table: string[][]): ImportPreview {
  if (table.length === 0 || table.every((row) => row.every((cell) => !cell.trim()))) {
    return { error: "The file has no rows.", rows: [] };
  }
  const header = table[0] ?? [];
  const columns = new Map<keyof typeof ALIASES, number>();
  for (let index = 0; index < header.length; index++) {
    const field = fieldForHeader(header[index] ?? "");
    if (!field) continue;
    if (columns.has(field)) return { error: `Two columns match ${headerLabel(field)}.`, rows: [] };
    columns.set(field, index);
  }
  if (!columns.has("qty")) return { error: "The first row needs a quantity column, such as Qty.", rows: [] };
  if (!columns.has("sku") && !columns.has("description")) {
    return { error: "The first row needs an item id or a description column.", rows: [] };
  }
  if (!columns.has("unitPrice") && !columns.has("extPrice")) {
    return { error: "The first row needs a unit price or an extension column.", rows: [] };
  }

  const rows: ImportPreviewRow[] = [];
  for (let index = 1; index < table.length; index++) {
    const source = table[index] ?? [];
    const sku = cell(source, columns.get("sku"));
    const description = cell(source, columns.get("description"));
    const qtyText = cell(source, columns.get("qty"));
    const unitText = cell(source, columns.get("unit"));
    const unitTextPrice = cell(source, columns.get("unitPrice"));
    const extText = cell(source, columns.get("extPrice"));
    if (!sku && !description && !qtyText && !unitText && !unitTextPrice && !extText) continue;
    rows.push(interpretRow(index + 1, sku, description, qtyText, unitText, unitTextPrice, extText));
    if (rows.length > MAX_ROWS) return { error: "A purchase order can have at most 100 lines.", rows: [] };
  }
  if (rows.length === 0) return { error: "The file has no lines.", rows: [] };
  return { error: null, rows };
}

export function applyItemMatch(row: ImportPreviewRow, match: ItemMatch | null): ImportPreviewRow {
  if (row.level === "error") return row;
  const sku = row.itemSku.trim();
  if (!sku) return row;
  if (!match) {
    return {
      ...row,
      itemId: "",
      itemSku: "",
      itemName: "",
      description: row.description || sku,
      level: "warning",
      message: "Unknown item. The line will keep a description.",
    };
  }
  return {
    ...row,
    itemId: match.id,
    itemSku: match.sku,
    itemName: match.name,
    description: row.description || match.description,
    level: "ok",
    message: null,
  };
}

function interpretRow(
  rowNumber: number,
  sku: string,
  description: string,
  qtyText: string,
  unitText: string,
  unitTextPrice: string,
  extText: string,
): ImportPreviewRow {
  const base = {
    rowNumber,
    itemId: "",
    itemSku: sku,
    itemName: "",
    description,
    qty: qtyText,
    unit: unitText || "Piece",
    unitCost: unitTextPrice,
    extPrice: extText,
  };
  const fail = (message: string): ImportPreviewRow => ({ ...base, level: "error", message });
  if (description.length > 500) return fail("A line description is too long.");
  if (base.unit.length > 40) return fail("Unit is too long.");
  const qty = parseQty(qtyText);
  if (qty == null || qty <= 0) return fail("Each line needs a quantity greater than zero.");
  if (unitTextPrice && parseUnitCost(unitTextPrice) == null) return fail("Unit price must be a USD amount with at most 4 decimal places.");
  if (extText && parseExtension(extText) == null) return fail("Extension must be a USD amount.");
  let unitCost = unitTextPrice ? parseUnitCost(unitTextPrice) : null;
  let extPrice = extText ? parseExtension(extText) : null;
  if (unitCost == null && extPrice == null) return fail("Each line needs a unit price or an extension.");
  if (!sku && !description) return fail("Each line needs an item id or a description.");
  if (unitCost != null && extPrice == null) {
    extPrice = extensionFromUnit(qty, unitCost);
    if (extPrice > 9999999999.99) return fail("Extension is too large.");
  } else if (unitCost == null && extPrice != null) {
    unitCost = unitFromExtension(qty, extPrice);
  }
  if (unitCost == null || extPrice == null || !pricesMatch(qty, unitCost, extPrice)) {
    return fail("Quantity, unit price, and extension do not match.");
  }
  return {
    ...base,
    qty: String(qty),
    unitCost: formatUnitPrice(unitCost),
    extPrice: formatExtension(extPrice),
    level: "ok",
    message: null,
  };
}

function cell(row: string[], index: number | undefined): string {
  if (index == null) return "";
  return (row[index] ?? "").trim();
}

function fieldForHeader(header: string): keyof typeof ALIASES | null {
  const key = normalizeHeader(header);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(ALIASES) as [keyof typeof ALIASES, string[]][]) {
    if (aliases.some((alias) => normalizeHeader(alias) === key)) return field;
  }
  return null;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[#_./\\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function headerLabel(field: keyof typeof ALIASES): string {
  if (field === "sku") return "item id";
  if (field === "unitPrice") return "unit price";
  if (field === "extPrice") return "extension";
  if (field === "qty") return "quantity";
  return field;
}
