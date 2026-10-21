import { errorText } from "@/lib/errors";
import { requireServiceSupabase } from "@/lib/supabaseAdmin";

export async function readGoogleRefreshToken(userId: string): Promise<string | null> {
  const { data, error } = await requireServiceSupabase()
    .from("user_google_drive")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(errorText(error));
  const token = data?.refresh_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export async function saveGoogleRefreshToken(userId: string, refreshToken: string): Promise<void> {
  const { error } = await requireServiceSupabase().from("user_google_drive").upsert(
    { user_id: userId, refresh_token: refreshToken, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(errorText(error));
}
