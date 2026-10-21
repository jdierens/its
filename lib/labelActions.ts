"use server";

import { errorText } from "@/lib/errors";
import {
  BIN_TEMPLATE_SETTINGS,
  ITEM_LABEL_TEMPLATE_KEY,
  LABEL_TEMPLATE_KEY,
  emptyBinLabelTemplates,
  itemTemplateFromSettings,
  labelTemplateOrDefault,
  type BinLabelTemplates,
  type LabelTemplateId,
} from "@/lib/labelTemplates";
import { getSupabase } from "@/lib/supabase";

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
  const { data, error } = await (await getSupabase()).from("app_settings").select("key, value").in("key", keys);
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
