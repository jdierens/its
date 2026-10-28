"use server";

import { errorText } from "@/lib/errors";
import {
  REPLACEMENT_PICK_SETTING_KEY,
  replacementPickAllowed,
  replacementSettingValue,
} from "@/lib/skuReplacement";
import { getSupabase } from "@/lib/supabase";

export async function fetchReplacementPickAllowed(): Promise<boolean> {
  const { data, error } = await (await getSupabase())
    .from("app_settings")
    .select("value")
    .eq("key", REPLACEMENT_PICK_SETTING_KEY)
    .maybeSingle();
  if (error) throw new Error(errorText(error));
  return replacementPickAllowed(data?.value == null ? null : String(data.value));
}

/** Admin setting. A missing row is off. Stored text is true or false, not a credential. */
export async function saveReplacementPickAllowed(on: boolean): Promise<boolean> {
  const value = replacementSettingValue(on);
  const { error } = await (await getSupabase()).from("app_settings").upsert({
    key: REPLACEMENT_PICK_SETTING_KEY,
    value,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(errorText(error));
  return on;
}
