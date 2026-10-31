export const MONEY_FIELDS = ["ecommerce_price", "market_price", "msrp"] as const;

export type MoneyField = (typeof MONEY_FIELDS)[number];

const FIELD_HEADER: Record<string, string> = {
  sku: "SKU",
  name: "Name",
  description: "Description",
  taxonomy: "Taxonomy",
  item_type: "Item type",
  manufacturer: "Manufacturer",
  model: "Model",
  part_number: "Part number",
  oem_name: "OEM name",
  oem_part_number: "OEM part number",
  unit: "Unit",
  condition: "Condition",
  condition_note: "Condition note",
  eccn: "ECCN",
  us_hts: "US HTS",
  ccats: "CCATS",
  coo: "COO",
  quantity: "Quantity",
  product_url: "Product URL",
  ecommerce_price: "Ecommerce price",
  market_price: "Market price",
  msrp: "MSRP",
  edited: "Edited",
};

export const ALL_FIELD_IDS = [
  "sku",
  "name",
  "description",
  "taxonomy",
  "item_type",
  "manufacturer",
  "model",
  "part_number",
  "oem_name",
  "oem_part_number",
  "unit",
  "condition",
  "condition_note",
  "eccn",
  "us_hts",
  "ccats",
  "coo",
  "quantity",
  "product_url",
  "ecommerce_price",
  "market_price",
  "msrp",
] as const;

export type ExportAttribute = {
  name: string;
  taxonomySort: number;
  sort: number;
};

export type ExportItem = {
  sku: string;
  name: string;
  description: string;
  taxonomy: string;
  itemType: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  oemName: string;
  oemPartNumber: string;
  productUrl: string;
  unit: string;
  condition: string;
  conditionNote: string;
  eccn: string;
  usHts: string;
  ccats: string;
  coo: string;
  quantity: string;
  prices: Partial<Record<MoneyField, string>>;
  updatedAt: string;
  attributes: Record<string, string>;
  attributeOrder: ExportAttribute[];
};

export type ExportTable = {
  headers: string[];
  rows: string[][];
};

const PACIFIC = "America/Los_Angeles";
const MONEY = new Set<string>(MONEY_FIELDS);

/** `YYYY-MM-DD HH:mm` in Pacific time, shared by spreadsheet export titles. */
export function exportStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = value("hour");
  if (hour === "24") hour = "00";
  return `${value("year")}-${value("month")}-${value("day")} ${hour}:${value("minute")}`;
}

export function exportTitle(date: Date): string {
  return `ITS items export ${exportStamp(date)}`;
}

export function moneyCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value).trim();
  return number.toFixed(2);
}

export function timestampCell(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

export function guardSpreadsheetFormula(value: string): string {
  if (/^[=+\-@\t\r]/.test(value) || /^\s+[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

export function attributeColumns(items: readonly ExportItem[]): string[] {
  const seen = new Map<string, { taxonomySort: number; sort: number }>();
  for (const item of items) {
    for (const attribute of item.attributeOrder) {
      const name = attribute.name.trim();
      if (!name) continue;
      const current = seen.get(name);
      if (
        !current ||
        attribute.taxonomySort < current.taxonomySort ||
        (attribute.taxonomySort === current.taxonomySort && attribute.sort < current.sort)
      ) {
        seen.set(name, { taxonomySort: attribute.taxonomySort, sort: attribute.sort });
      }
    }
    for (const name of Object.keys(item.attributes)) {
      if (!seen.has(name)) seen.set(name, { taxonomySort: Number.MAX_SAFE_INTEGER, sort: Number.MAX_SAFE_INTEGER });
    }
  }

  return [...seen.entries()]
    .sort((a, b) => a[1].taxonomySort - b[1].taxonomySort || a[1].sort - b[1].sort || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

export function exportColumnIds(input: {
  columns: "all" | readonly string[];
  includeMoney: boolean;
  items: readonly ExportItem[];
}): { id: string; header: string }[] {
  const requested = input.columns === "all" ? ALL_FIELD_IDS : input.columns;
  const chosen: { id: string; header: string }[] = [];
  const seen = new Set<string>();
  for (const raw of requested) {
    const id = raw.trim();
    if (!id || id === "photo" || id === "fields" || seen.has(id)) continue;
    if (MONEY.has(id) && !input.includeMoney) continue;
    if (id.startsWith("attr:")) {
      const name = id.slice(5).trim();
      if (!name) continue;
      seen.add(id);
      chosen.push({ id, header: name });
      continue;
    }
    const header = FIELD_HEADER[id];
    if (!header) continue;
    seen.add(id);
    chosen.push({ id, header });
  }
  if (input.columns === "all") {
    for (const name of attributeColumns(input.items)) {
      const id = `attr:${name}`;
      if (seen.has(id)) continue;
      chosen.push({ id, header: name });
    }
  }
  return chosen;
}

function fieldValue(item: ExportItem, id: string): string {
  if (id === "sku") return item.sku;
  if (id === "name") return item.name;
  if (id === "description") return item.description;
  if (id === "taxonomy") return item.taxonomy;
  if (id === "item_type") return item.itemType;
  if (id === "manufacturer") return item.manufacturer;
  if (id === "model") return item.model;
  if (id === "part_number") return item.partNumber;
  if (id === "oem_name") return item.oemName;
  if (id === "oem_part_number") return item.oemPartNumber;
  if (id === "unit") return item.unit;
  if (id === "condition") return item.condition;
  if (id === "condition_note") return item.conditionNote;
  if (id === "eccn") return item.eccn;
  if (id === "us_hts") return item.usHts;
  if (id === "ccats") return item.ccats;
  if (id === "coo") return item.coo;
  if (id === "quantity") return item.quantity;
  if (id === "product_url") return item.productUrl;
  if (id === "ecommerce_price") return item.prices.ecommerce_price ?? "";
  if (id === "market_price") return item.prices.market_price ?? "";
  if (id === "msrp") return item.prices.msrp ?? "";
  if (id === "edited") return item.updatedAt;
  if (id.startsWith("attr:")) return item.attributes[id.slice(5)] ?? "";
  return "";
}

export function buildExportTable(
  items: readonly ExportItem[],
  options: { columns: "all" | readonly string[]; includeMoney: boolean },
): ExportTable {
  const columns = exportColumnIds({ ...options, items });
  return {
    headers: columns.map((column) => column.header),
    rows: items.map((item) => columns.map((column) => guardSpreadsheetFormula(fieldValue(item, column.id)))),
  };
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function toCsv(table: ExportTable): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map((value) => csvCell(value)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
