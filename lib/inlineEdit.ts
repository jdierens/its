import { productUrlError } from "@/lib/productUrl";
import {
  DEFAULT_ECCN,
  DEFAULT_UNIT,
  NEW_CONDITION_NOTES,
  SEEDED_UNITS,
  attributeValueError,
  conditionNoteAfterChange,
  htsError,
  isItemCondition,
  isItemType,
} from "@/lib/itemFields";
import type { DataType, ItemListRow } from "@/lib/types";

export const READ_ONLY_COLUMNS = new Set([
  "photo",
  "taxonomy",
  "sku",
  "name",
  "quantity",
  "edited",
  "fields",
]);

const PRICE_COLUMNS = new Set(["ecommerce_price", "market_price", "msrp"]);

export function isEditableColumn(columnId: string): boolean {
  if (READ_ONLY_COLUMNS.has(columnId)) return false;
  if (columnId.startsWith("attr:")) return true;
  return (
    columnId === "manufacturer" ||
    columnId === "model" ||
    columnId === "part_number" ||
    columnId === "oem_name" ||
    columnId === "oem_part_number" ||
    columnId === "product_url" ||
    columnId === "unit" ||
    columnId === "condition" ||
    columnId === "condition_note" ||
    columnId === "eccn" ||
    columnId === "us_hts" ||
    columnId === "ccats" ||
    columnId === "coo" ||
    columnId === "item_type" ||
    PRICE_COLUMNS.has(columnId)
  );
}

export function priceError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return "Enter a price with up to 2 decimal places.";
  if (Number(trimmed) >= 10_000_000_000) return "Price is too large.";
  return null;
}

export function editedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export type CellCheck = {
  value: string;
  error: string | null;
  conditionNote?: string;
};

export function validateCell(input: {
  columnId: string;
  value: string;
  condition: string;
  conditionNote?: string;
  dataType?: DataType;
  units?: readonly string[];
}): CellCheck {
  const trimmed = input.value.trim();
  if (input.columnId === "unit") {
    if (!trimmed) return { value: DEFAULT_UNIT, error: null };
    const choices = input.units && input.units.length > 0 ? input.units : SEEDED_UNITS;
    const found = choices.find((unit) => unit.toLowerCase() === trimmed.toLowerCase());
    if (!found) return { value: trimmed, error: "Unit must be one of the units list." };
    return { value: found, error: null };
  }
  if (input.columnId === "item_type") {
    if (!isItemType(trimmed)) {
      return { value: trimmed, error: "Item type must be Product, Kit/Package, Service, or Non-inventory." };
    }
    return { value: trimmed, error: null };
  }
  if (input.columnId === "condition") {
    if (!isItemCondition(trimmed)) return { value: trimmed, error: "Condition must be New or Used." };
    return {
      value: trimmed,
      error: null,
      conditionNote: conditionNoteAfterChange(trimmed, input.conditionNote ?? ""),
    };
  }
  if (input.columnId === "condition_note") {
    if (input.condition === "New" && trimmed && !NEW_CONDITION_NOTES.includes(trimmed as (typeof NEW_CONDITION_NOTES)[number])) {
      return {
        value: trimmed,
        error: "For a new item, the condition note must be Factory Sealed, New Open Box, or empty.",
      };
    }
    return { value: trimmed, error: null };
  }
  if (input.columnId === "us_hts") {
    const problem = htsError(trimmed);
    return { value: trimmed, error: problem };
  }
  if (input.columnId === "eccn") return { value: trimmed || DEFAULT_ECCN, error: null };
  if (input.columnId === "coo") {
    const code = trimmed.toUpperCase();
    if (code && !/^[A-Z]{3}$/.test(code)) return { value: code, error: "Country of origin must be an ISO alpha-3 code." };
    return { value: code, error: null };
  }
  if (PRICE_COLUMNS.has(input.columnId)) {
    return { value: trimmed, error: priceError(trimmed) };
  }
  if (input.columnId.startsWith("attr:")) {
    const problem = attributeValueError(input.dataType ?? "text", trimmed);
    return { value: trimmed, error: problem };
  }
  if (input.columnId === "product_url") {
    return { value: trimmed, error: productUrlError(trimmed) };
  }
  if (input.columnId === "manufacturer") {
    if (trimmed && !/^[0-9a-f-]{36}$/i.test(trimmed)) {
      return { value: trimmed, error: "Choose a manufacturer from the list, or add the new name." };
    }
    return { value: trimmed, error: null };
  }
  return { value: trimmed, error: null };
}

export function cellKeyAction(input: {
  key: string;
  editable: boolean;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
}): "edit" | "type" | "open" | null {
  if (input.meta || input.ctrl || input.alt) return null;
  if (input.key === "Enter") return input.editable ? "edit" : "open";
  if (input.editable && input.key.length === 1 && input.key !== "/") return "type";
  return null;
}

export function isConflictMessage(message: string): boolean {
  return /edited somewhere else/i.test(message);
}

export function patchRow(row: ItemListRow, columnId: string, value: string): ItemListRow {
  if (columnId === "manufacturer") return row;
  if (columnId === "model") return { ...row, model: value };
  if (columnId === "part_number") return { ...row, partNumber: value };
  if (columnId === "oem_name") return { ...row, oemName: value };
  if (columnId === "oem_part_number") return { ...row, oemPartNumber: value };
  if (columnId === "product_url") return { ...row, productUrl: value };
  if (columnId === "unit") return { ...row, unit: value };
  if (columnId === "condition") {
    const next = value === "New" ? "New" : "Used";
    return {
      ...row,
      condition: next,
      conditionNote: conditionNoteAfterChange(next, row.conditionNote),
    };
  }
  if (columnId === "condition_note") return { ...row, conditionNote: value };
  if (columnId === "eccn") return { ...row, eccn: value };
  if (columnId === "us_hts") return { ...row, usHts: value };
  if (columnId === "ccats") return { ...row, ccats: value };
  if (columnId === "coo") return { ...row, coo: value };
  if (columnId === "item_type" && isItemType(value)) return { ...row, itemType: value };
  if (columnId === "ecommerce_price") return { ...row, ecommercePrice: value || null };
  if (columnId === "market_price") return { ...row, marketPrice: value || null };
  if (columnId === "msrp") return { ...row, msrp: value || null };
  if (columnId.startsWith("attr:")) {
    const name = columnId.slice(5);
    const fields = { ...row.fields };
    if (value) fields[name] = value;
    else delete fields[name];
    return { ...row, fields };
  }
  return row;
}

export function restoreField(current: ItemListRow, original: ItemListRow, columnId: string): ItemListRow {
  if (columnId === "manufacturer") {
    return {
      ...current,
      manufacturerId: original.manufacturerId,
      manufacturerName: original.manufacturerName,
    };
  }
  if (columnId === "condition") {
    return { ...current, condition: original.condition, conditionNote: original.conditionNote };
  }
  return patchRow(current, columnId, rawCellValue(original, columnId));
}

export function rawCellValue(row: ItemListRow, columnId: string): string {
  if (columnId === "manufacturer") return row.manufacturerId ?? "";
  if (columnId === "model") return row.model;
  if (columnId === "part_number") return row.partNumber;
  if (columnId === "oem_name") return row.oemName;
  if (columnId === "oem_part_number") return row.oemPartNumber;
  if (columnId === "product_url") return row.productUrl;
  if (columnId === "unit") return row.unit;
  if (columnId === "condition") return row.condition;
  if (columnId === "condition_note") return row.conditionNote;
  if (columnId === "eccn") return row.eccn;
  if (columnId === "us_hts") return row.usHts;
  if (columnId === "ccats") return row.ccats;
  if (columnId === "coo") return row.coo;
  if (columnId === "item_type") return row.itemType;
  if (columnId === "ecommerce_price") return row.ecommercePrice ?? "";
  if (columnId === "market_price") return row.marketPrice ?? "";
  if (columnId === "msrp") return row.msrp ?? "";
  if (columnId.startsWith("attr:")) return row.fields[columnId.slice(5)] ?? "";
  return "";
}
