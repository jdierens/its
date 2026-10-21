import type { SupabaseClient } from "@supabase/supabase-js";
import { authRequired } from "@/lib/authRequired";
import { readAppUser } from "@/lib/appUserRecord";
import { requireServiceSupabase } from "@/lib/supabaseAdmin";

/**
 * Server-side data client. It uses the service role, which bypasses row level
 * security. The browser must not call it. When AUTH_REQUIRED is true, the
 * signed-in person must be an approved app_users row. Sign-in itself uses
 * lib/supabaseBrowser.ts and the publishable key.
 */
export async function getSupabase(): Promise<SupabaseClient> {
  if (typeof window !== "undefined") {
    throw new Error("Database calls run on the server.");
  }
  if (authRequired()) {
    const { sessionUser } = await import("@/lib/sessionUser");
    const session = await sessionUser();
    if (!session) throw new Error("Sign in required.");
    const user = await readAppUser(session.id);
    if (!user || user.status !== "approved") throw new Error("This account cannot change data.");
  }
  return requireServiceSupabase();
}
