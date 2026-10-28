import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import { bankFeedAllowed } from "@/lib/plaid/access";
import { sessionUser } from "@/lib/sessionUser";
import type { AppRole } from "@/lib/authDomain";

export type PlaidActor =
  | { ok: true; email: string | null }
  | { ok: false; status: number; message: string };

export async function plaidActor(): Promise<PlaidActor> {
  if (!authRequired()) return { ok: true, email: null };
  const session = await sessionUser();
  if (!session) return { ok: false, status: 401, message: "Sign in required." };
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") {
    return { ok: false, status: 403, message: "This account cannot change data." };
  }
  const role = user.role === "admin" || user.role === "staff" || user.role === "read_only" ? user.role : null;
  if (!bankFeedAllowed(role as AppRole | null, true)) {
    return { ok: false, status: 403, message: "Bank feeds are limited to admin and staff." };
  }
  return { ok: true, email: session.email };
}
