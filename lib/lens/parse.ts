import type { LensReading } from "@/lib/lens/rank";

const ITEM_TYPES = new Set(["Product", "Kit/Package", "Service", "Non-inventory"]);

export function parseLensReading(value: unknown): LensReading | null {
  const record = asRecord(value);
  if (!record) return null;
  const partNumbers = stringList(record.partNumbers);
  const specs = specList(record.specs);
  const specCodes = unique([
    ...specs.filter((spec) => /spec|fru|s-spec/i.test(spec.name)).map((spec) => spec.value),
    ...partNumbers.filter((part) => /^S[A-Z]{0,3}\d{3,}/i.test(normalizeLoose(part))),
  ]);
  const itemType = typeof record.itemType === "string" && ITEM_TYPES.has(record.itemType) ? record.itemType : "";
  return {
    manufacturer: text(record.manufacturer),
    partNumbers,
    model: text(record.model),
    itemType,
    taxonomy: text(record.taxonomy),
    specs,
    specCodes,
    conditionHints: text(record.conditionHints),
    rawText: text(record.rawText),
    confidence: clampConfidence(record.confidence),
  };
}

export function lensResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      manufacturer: { type: "string" },
      partNumbers: { type: "array", items: { type: "string" } },
      model: { type: "string" },
      itemType: { type: "string", enum: ["Product", "Kit/Package", "Service", "Non-inventory", ""] },
      taxonomy: { type: "string" },
      specs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "string" },
          },
          required: ["name", "value"],
        },
      },
      conditionHints: { type: "string" },
      rawText: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["manufacturer", "partNumbers", "model", "itemType", "taxonomy", "specs", "conditionHints", "rawText", "confidence"],
  };
}

export function lensPrompt(taxonomies: string[]): string {
  const list = taxonomies.map((name) => name.trim()).filter(Boolean).slice(0, 80).join(", ");
  return [
    "Identify the hardware in these photos for an inventory system.",
    "Read every visible part number, FRU, OPN, and S-spec. Do not invent numbers that are not printed.",
    "itemType must be Product, Kit/Package, Service, Non-inventory, or empty.",
    list ? `taxonomy must be one of: ${list}. Leave taxonomy empty if none fit.` : "Leave taxonomy empty.",
    "confidence is a number from 0 to 1 for how sure you are of the reading.",
    "rawText is the text you can actually see.",
  ].join(" ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(value.filter((entry): entry is string => typeof entry === "string"));
}

function specList(value: unknown): { name: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  const specs: { name: string; value: string }[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const name = text(record.name);
    const specValue = text(record.value);
    if (!name || !specValue) continue;
    specs.push({ name, value: specValue });
  }
  return specs;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function normalizeLoose(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function clampConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, Math.round(number * 1000) / 1000));
}
