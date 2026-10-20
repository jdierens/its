import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

export const LABEL_TEMPLATE_KEY = "label_template";
export const ITEM_LABEL_TEMPLATE_KEY = "label_template_item";

export const LABEL_TEMPLATES = [
  { id: "barcode", label: "Barcode (current)" },
  { id: "qr", label: "QR code" },
] as const;

export type LabelTemplateId = (typeof LABEL_TEMPLATES)[number]["id"];

export const DEFAULT_LABEL_TEMPLATE: LabelTemplateId = "barcode";

export const LABEL_TYPES = [
  {
    id: "item",
    label: "Item",
    detail: "Printed from an item. 90 × 29 mm.",
    ready: true,
  },
  {
    id: "pallet",
    label: "Pallet",
    detail: "Bin label. Coming soon.",
    ready: false,
  },
  {
    id: "crate",
    label: "Crate",
    detail: "Bin label. Coming soon.",
    ready: false,
  },
  {
    id: "box",
    label: "Box",
    detail: "Bin label. Coming soon.",
    ready: false,
  },
  {
    id: "location",
    label: "Rack location",
    detail: "Warehouse rack location. Coming soon.",
    ready: false,
  },
] as const;

export type LabelTypeId = (typeof LABEL_TYPES)[number]["id"];

// Templates available for each label type. Only item prints today.
export const TEMPLATES_BY_LABEL_TYPE: Record<LabelTypeId, readonly (typeof LABEL_TEMPLATES)[number][]> = {
  item: LABEL_TEMPLATES,
  pallet: [],
  crate: [],
  box: [],
  location: [],
};

// Five printer dots at 300 dpi. 1.6 CSS px, so a 300 dpi print stays on whole dots.
export const QR_MODULE_MM = (5 * 25.4) / 300;
export const QR_QUIET_MODULES = 4;
export const QR_ERROR_CORRECTION = "M" as const;

export function isLabelTemplateId(value: string | null | undefined): value is LabelTemplateId {
  return LABEL_TEMPLATES.some((template) => template.id === value);
}

export function labelTemplateOrDefault(value: string | null | undefined): LabelTemplateId {
  return isLabelTemplateId(value) ? value : DEFAULT_LABEL_TEMPLATE;
}

// label_template_item wins. The older label_template key is the fallback so a
// database that only has the original setting still prints the chosen template.
export function itemTemplateFromSettings(
  itemValue: string | null | undefined,
  legacyValue: string | null | undefined,
): LabelTemplateId {
  if (isLabelTemplateId(itemValue)) return itemValue;
  return labelTemplateOrDefault(legacyValue);
}

export function labelTemplateLabel(id: LabelTemplateId): string {
  return LABEL_TEMPLATES.find((template) => template.id === id)?.label ?? LABEL_TEMPLATES[0].label;
}

export const BIN_LABEL_TEMPLATES = [
  { id: "barcode", label: "Big reference + barcode" },
  { id: "qr", label: "Big reference + QR" },
] as const;

export const BIN_TEMPLATE_SETTINGS = [
  { type: "P", key: "label_template_pallet", label: "Pallet" },
  { type: "C", key: "label_template_crate", label: "Crate" },
  { type: "B", key: "label_template_box", label: "Box" },
] as const;

export type BinTemplateType = (typeof BIN_TEMPLATE_SETTINGS)[number]["type"];
export type BinLabelTemplates = Record<BinTemplateType, LabelTemplateId>;

export function binLabelTemplateLabel(id: LabelTemplateId): string {
  return BIN_LABEL_TEMPLATES.find((template) => template.id === id)?.label ?? BIN_LABEL_TEMPLATES[0].label;
}

export function emptyBinLabelTemplates(): BinLabelTemplates {
  return { P: DEFAULT_LABEL_TEMPLATE, C: DEFAULT_LABEL_TEMPLATE, B: DEFAULT_LABEL_TEMPLATE };
}

// Side of the symbol including the quiet zone, in millimetres.
export function qrSymbolMm(moduleCount: number): number {
  return (moduleCount + QR_QUIET_MODULES * 2) * QR_MODULE_MM;
}

// One URL, so a phone camera opens the item. The sku query is for the person
// reading the scan; the item page loads by id and ignores it. Origin is the
// public address of the app being browsed, not a fixed host.
export function qrLabelPayload(origin: string, id: string, sku: string): string {
  const base = origin.trim().replace(/\/+$/, "");
  const url = new URL(`${base}/items/${id}`);
  const code = sku.trim();
  if (code) url.searchParams.set("sku", code);
  return url.href;
}

export async function fetchLabelTemplate(): Promise<LabelTemplateId> {
  const { data, error } = await (await getSupabase())
    .from("app_settings")
    .select("key, value")
    .in("key", [ITEM_LABEL_TEMPLATE_KEY, LABEL_TEMPLATE_KEY]);
  if (error) throw new Error(errorText(error));
  const rows = data ?? [];
  const itemValue = rows.find((row) => row.key === ITEM_LABEL_TEMPLATE_KEY)?.value;
  const legacyValue = rows.find((row) => row.key === LABEL_TEMPLATE_KEY)?.value;
  return itemTemplateFromSettings(
    typeof itemValue === "string" ? itemValue : null,
    typeof legacyValue === "string" ? legacyValue : null,
  );
}

export async function saveLabelTemplate(id: LabelTemplateId): Promise<void> {
  const updated_at = new Date().toISOString();
  const { error } = await (await getSupabase())
    .from("app_settings")
    .upsert([
      { key: ITEM_LABEL_TEMPLATE_KEY, value: id, updated_at },
      { key: LABEL_TEMPLATE_KEY, value: id, updated_at },
    ]);
  if (error) throw new Error(errorText(error));
}

export async function fetchBinLabelTemplates(): Promise<BinLabelTemplates> {
  const keys = BIN_TEMPLATE_SETTINGS.map((setting) => setting.key);
  const { data, error } = await (await getSupabase())
    .from("app_settings")
    .select("key, value")
    .in("key", keys);
  if (error) throw new Error(errorText(error));
  const stored = new Map((data ?? []).map((row) => [String(row.key), row.value]));
  const templates = emptyBinLabelTemplates();
  for (const setting of BIN_TEMPLATE_SETTINGS) {
    const raw = stored.get(setting.key);
    templates[setting.type] = labelTemplateOrDefault(typeof raw === "string" ? raw : null);
  }
  return templates;
}

export async function saveBinLabelTemplates(templates: BinLabelTemplates): Promise<void> {
  const updatedAt = new Date().toISOString();
  const { error } = await (await getSupabase())
    .from("app_settings")
    .upsert(
      BIN_TEMPLATE_SETTINGS.map((setting) => ({
        key: setting.key,
        value: templates[setting.type],
        updated_at: updatedAt,
      })),
    );
  if (error) throw new Error(errorText(error));
}
