export const DEFAULT_ECCN = "5A992.C";
export const DEFAULT_CONDITION = "Used" as const;
export const NEW_CONDITION_NOTES = ["Factory Sealed", "New Open Box"] as const;
export const ITEM_TYPES = ["Product", "Kit/Package", "Service", "Non-inventory"] as const;
export const DEFAULT_ITEM_TYPE = "Product" as const;

export type ItemCondition = "New" | "Used";
export type NewConditionNote = (typeof NEW_CONDITION_NOTES)[number];
export type ItemType = (typeof ITEM_TYPES)[number];

export function collapseLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeLabel(value: string): string {
  const collapsed = collapseLabel(value);
  return collapsed.toLowerCase();
}

export function countryLabel(alpha3: string, name: string): string {
  return `${alpha3} — ${name}`;
}

export function htsError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[0-9]+(\.[0-9]+)*$/.test(trimmed)) {
    return "Use digits and optional dots, like 8471.30.0100.";
  }
  if (trimmed.replace(/\D/g, "").length > 10) return "Use at most 10 digits.";
  return null;
}

export function conditionNoteAfterChange(condition: ItemCondition, note: string): string {
  const trimmed = note.trim();
  const listed = NEW_CONDITION_NOTES.includes(trimmed as NewConditionNote);
  if (condition === "New") return listed ? trimmed : "";
  if (listed) return "";
  return note;
}

export function isItemCondition(value: string): value is ItemCondition {
  return value === "New" || value === "Used";
}

export function isItemType(value: string): value is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(value);
}

export function itemTypeOrDefault(value: string | null | undefined): ItemType {
  return value && isItemType(value) ? value : DEFAULT_ITEM_TYPE;
}

export function attributeValueError(
  dataType: "integer" | "text" | "decimal",
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (dataType === "integer") {
    if (!/^-?\d+$/.test(trimmed)) return "Enter a whole number.";
    return null;
  }
  if (dataType === "decimal") {
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return "Enter a decimal number.";
    return null;
  }
  return null;
}
