export type TaxonomyFieldLink = {
  id: string;
  name: string;
  required: boolean;
  sortOrder: number;
};

export type ItemFieldValue = {
  attributeId: string;
  name: string;
  value: string;
};

export type KeptField = {
  id: string;
  name: string;
  value: string;
};

export type LostField = {
  id: string;
  name: string;
  value: string;
};

export type AddedField = {
  id: string;
  name: string;
  required: boolean;
  value: string;
};

export type TaxonomyChangePlan = {
  kept: KeptField[];
  lost: LostField[];
  added: AddedField[];
};

function bySort<T extends { sortOrder: number; name: string }>(left: T, right: T): number {
  return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name);
}

export function planTaxonomyChange(
  current: TaxonomyFieldLink[],
  next: TaxonomyFieldLink[],
  values: ItemFieldValue[],
): TaxonomyChangePlan {
  const valueById = new Map(values.map((row) => [row.attributeId, row.value.trim()]));
  const nextIds = new Set(next.map((field) => field.id));
  const currentIds = new Set(current.map((field) => field.id));

  const kept = current
    .filter((field) => nextIds.has(field.id))
    .slice()
    .sort(bySort)
    .map((field) => ({ id: field.id, name: field.name, value: valueById.get(field.id) ?? "" }));

  const lost = current
    .filter((field) => !nextIds.has(field.id) && (valueById.get(field.id) ?? "") !== "")
    .slice()
    .sort(bySort)
    .map((field) => ({ id: field.id, name: field.name, value: valueById.get(field.id) ?? "" }));

  const added = next
    .filter((field) => !currentIds.has(field.id))
    .slice()
    .sort(bySort)
    .map((field) => ({
      id: field.id,
      name: field.name,
      required: field.required,
      value: valueById.get(field.id) ?? "",
    }));

  return { kept, lost, added };
}

export function taxonomyChangeLabel(lostCount: number): string {
  if (lostCount <= 0) return "Change taxonomy";
  if (lostCount === 1) return "Change taxonomy and remove 1 value";
  return `Change taxonomy and remove ${lostCount} values`;
}

export function notesWithLostValues(notes: string, lost: { name: string; value: string }[]): string {
  if (lost.length === 0) return notes;
  const lines = lost.map((field) => `${field.name}: ${field.value}`).join("\n");
  const existing = notes.trim();
  return existing ? `${existing}\n${lines}` : lines;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function skuEmbedsShortCode(sku: string, shortCode: string): boolean {
  const code = shortCode.trim();
  if (!code) return false;
  return new RegExp(`(^|[^A-Za-z])${escapeRegExp(code)}($|[^A-Za-z])`, "i").test(sku);
}

export function replaceSkuShortCode(sku: string, fromCode: string, toCode: string): string {
  const from = fromCode.trim();
  const to = toCode.trim().toUpperCase();
  if (!from || !to || !skuEmbedsShortCode(sku, from)) return sku;
  return sku.replace(
    new RegExp(`(^|[^A-Za-z])${escapeRegExp(from)}($|[^A-Za-z])`, "gi"),
    (_match, lead: string, tail: string) => `${lead}${to}${tail}`,
  );
}
