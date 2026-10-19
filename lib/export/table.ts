export const FIXED_HEADERS = [
  "SKU",
  "Taxonomy",
  "Item type",
  "Manufacturer",
  "Model",
  "Part number",
  "OEM name",
  "OEM part number",
  "Unit",
  "Condition",
  "Condition note",
  "ECCN",
  "US HTS",
  "CCATS",
  "COO",
] as const;

export const PRICING_FIELDS = [
  { key: "ecommerce_price", label: "Ecommerce price" },
  { key: "market_price", label: "Market price" },
  { key: "msrp", label: "MSRP" },
  { key: "pricing_checked_at", label: "Pricing checked" },
] as const;

export type PricingKey = (typeof PRICING_FIELDS)[number]["key"];

const PRICING_LABEL = new Map<string, string>(PRICING_FIELDS.map((field) => [field.key, field.label]));

export type ExportAttribute = {
  name: string;
  taxonomySort: number;
  sort: number;
};

export type ExportItem = {
  sku: string;
  taxonomy: string;
  itemType: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  oemName: string;
  oemPartNumber: string;
  unit: string;
  condition: string;
  conditionNote: string;
  eccn: string;
  usHts: string;
  ccats: string;
  coo: string;
  prices: Partial<Record<PricingKey, string>>;
  primaryImageUrl: string;
  createdAt: string;
  updatedAt: string;
  attributes: Record<string, string>;
  attributeOrder: ExportAttribute[];
};

export type ExportTable = {
  headers: string[];
  rows: string[][];
};

const PACIFIC = "America/Los_Angeles";

export function exportTitle(date: Date): string {
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
  return `ITS items export ${value("year")}-${value("month")}-${value("day")} ${hour}:${value("minute")}`;
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

export function buildExportTable(items: readonly ExportItem[], pricingKeys: readonly PricingKey[]): ExportTable {
  const pricing = pricingKeys.filter((key) => PRICING_LABEL.has(key));
  const attributes = attributeColumns(items);
  const headers = [
    ...FIXED_HEADERS,
    ...pricing.map((key) => PRICING_LABEL.get(key) ?? key),
    "Primary image URL",
    "Created",
    "Updated",
    ...attributes,
  ];

  const rows = items.map((item) => [
    item.sku,
    item.taxonomy,
    item.itemType,
    item.manufacturer,
    item.model,
    item.partNumber,
    item.oemName,
    item.oemPartNumber,
    item.unit,
    item.condition,
    item.conditionNote,
    item.eccn,
    item.usHts,
    item.ccats,
    item.coo,
    ...pricing.map((key) => item.prices[key] ?? ""),
    item.primaryImageUrl,
    item.createdAt,
    item.updatedAt,
    ...attributes.map((name) => item.attributes[name] ?? ""),
  ]);

  return { headers, rows };
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function toCsv(table: ExportTable): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map((value) => csvCell(value)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
