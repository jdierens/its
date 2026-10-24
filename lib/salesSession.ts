import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import { salesAccessForRole, type SalesAccess } from "@/lib/salesAccess";
import { sessionUser } from "@/lib/sessionUser";

export async function salesPageAccess(): Promise<SalesAccess> {
  if (!authRequired()) return salesAccessForRole(null, false);
  const session = await sessionUser();
  if (!session) return salesAccessForRole(null, true);
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") return salesAccessForRole(null, true);
  return salesAccessForRole(user.role, true);
}

export async function salesOperatorId(): Promise<string | null> {
  if (!authRequired()) return null;
  const session = await sessionUser();
  if (!session) throw new Error("Sign in required.");
  return session.id;
}
