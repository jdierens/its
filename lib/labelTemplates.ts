import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

export const LABEL_TEMPLATE_KEY = "label_template";

export const LABEL_TEMPLATES = [
  { id: "barcode", label: "Barcode (current)" },
  { id: "qr", label: "QR code" },
] as const;

export type LabelTemplateId = (typeof LABEL_TEMPLATES)[number]["id"];

export const DEFAULT_LABEL_TEMPLATE: LabelTemplateId = "barcode";

// Five printer dots at 300 dpi. 1.6 CSS px, so a 300 dpi print stays on whole dots.
export const QR_MODULE_MM = (5 * 25.4) / 300;
export const QR_QUIET_MODULES = 4;
export const QR_ERROR_CORRECTION = "M" as const;

export function labelTemplateOrDefault(value: string | null | undefined): LabelTemplateId {
  const found = LABEL_TEMPLATES.find((template) => template.id === value);
  return found ? found.id : DEFAULT_LABEL_TEMPLATE;
}

export function labelTemplateLabel(id: LabelTemplateId): string {
  return LABEL_TEMPLATES.find((template) => template.id === id)?.label ?? LABEL_TEMPLATES[0].label;
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
    .select("value")
    .eq("key", LABEL_TEMPLATE_KEY)
    .maybeSingle();
  if (error) throw new Error(errorText(error));
  return labelTemplateOrDefault(typeof data?.value === "string" ? data.value : null);
}

export async function saveLabelTemplate(id: LabelTemplateId): Promise<void> {
  const { error } = await (await getSupabase()).from("app_settings").upsert({
    key: LABEL_TEMPLATE_KEY,
    value: id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(errorText(error));
}
