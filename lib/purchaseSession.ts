import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import { purchaseAccessForRole, type PurchaseAccess } from "@/lib/purchaseAccess";
import { sessionUser } from "@/lib/sessionUser";

export async function purchasePageAccess(): Promise<PurchaseAccess> {
  if (!authRequired()) return purchaseAccessForRole(null, false);
  const session = await sessionUser();
  if (!session) return purchaseAccessForRole(null, true);
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") return purchaseAccessForRole(null, true);
  return purchaseAccessForRole(user.role, true);
}

export async function purchaseOperatorId(): Promise<string | null> {
  if (!authRequired()) return null;
  const session = await sessionUser();
  if (!session) throw new Error("Sign in required.");
  return session.id;
}
