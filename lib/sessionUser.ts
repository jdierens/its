import { getServerSupabase } from "@/lib/supabase.server";

export type SessionUser = {
  id: string;
  email: string;
};

/** The person in the auth cookie. Does not read app tables. */
export async function sessionUser(): Promise<SessionUser | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  const id = data.claims.sub;
  const email = data.claims.email;
  if (typeof id !== "string" || typeof email !== "string") return null;
  return { id, email };
}
