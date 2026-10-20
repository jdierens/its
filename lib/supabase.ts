import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browser: SupabaseClient | null = null;

function env(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return { url, key };
}

function browserClient(): SupabaseClient {
  const { url, key } = env();
  if (!browser) browser = createBrowserClient(url, key);
  return browser;
}

/**
 * Browser calls use the anon key plus the signed-in session cookie.
 * Server calls read that cookie so auth.uid() is the person, not the anon role.
 */
export async function getSupabase(): Promise<SupabaseClient> {
  if (typeof window !== "undefined") return browserClient();
  const { getServerSupabase } = await import("@/lib/supabase.server");
  return getServerSupabase();
}
