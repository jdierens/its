export const DEFAULT_ECCN = "5A992.C";
export const DEFAULT_CONDITION = "Used" as const;
export const NEW_CONDITION_NOTES = ["Factory Sealed", "New Open Box"] as const;
export const ITEM_TYPES = ["Product", "Kit/Package", "Service", "Non-inventory"] as const;
export const DEFAULT_ITEM_TYPE = "Product" as const;
export const DEFAULT_UNIT = "Piece";
export const SEEDED_UNITS = ["Piece", "Lbs"] as const;

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

export type CountryCode = {
  alpha3: string;
  alpha2: string;
  name: string;
};

export type CountryResolution =
  | { status: "empty" }
  | { status: "match"; alpha3: string }
  | { status: "none"; query: string }
  | { status: "ambiguous"; query: string };

function countryKey(value: string): string {
  return normalizeLabel(value)
    .replace(/[—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn a typed country into the ISO alpha-3 code stored on a pick or an item.
 * An exact code, an exact name, or the only list match wins. "India" is IND.
 * A blank value stays blank. Several matches stay unresolved.
 */
export function resolveCountry(query: string, countries: readonly CountryCode[]): CountryResolution {
  const shown = collapseLabel(query);
  const needle = countryKey(shown);
  if (!needle) return { status: "empty" };

  const exactAlpha3 = countries.find((country) => countryKey(country.alpha3) === needle);
  if (exactAlpha3) return { status: "match", alpha3: exactAlpha3.alpha3 };

  const exactAlpha2 = countries.find((country) => countryKey(country.alpha2) === needle);
  if (exactAlpha2) return { status: "match", alpha3: exactAlpha2.alpha3 };

  const exactName = countries.filter((country) => countryKey(country.name) === needle);
  if (exactName.length === 1) return { status: "match", alpha3: exactName[0].alpha3 };
  if (exactName.length > 1) return { status: "ambiguous", query: shown };

  const exactLabel = countries.find((country) => countryKey(countryLabel(country.alpha3, country.name)) === needle);
  if (exactLabel) return { status: "match", alpha3: exactLabel.alpha3 };

  const partial = countries.filter((country) => {
    const label = countryKey(`${country.alpha3} ${country.alpha2} ${country.name}`);
    return label.includes(needle);
  });
  if (partial.length === 1) return { status: "match", alpha3: partial[0].alpha3 };
  if (partial.length > 1) return { status: "ambiguous", query: shown };
  return { status: "none", query: shown };
}

export function countryResolutionMessage(result: CountryResolution): string | null {
  if (result.status === "none") return `No country matches ${result.query}. Choose one from the list.`;
  if (result.status === "ambiguous") return "Choose a country from the list.";
  return null;
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

export function unitOrDefault(
  value: string | null | undefined,
  choices: readonly string[] = SEEDED_UNITS,
): string {
  const trimmed = value?.trim() ?? "";
  const found = choices.find((unit) => unit.toLowerCase() === trimmed.toLowerCase());
  return found ?? DEFAULT_UNIT;
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
