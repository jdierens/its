import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import { pickAccessForRole, type PickAccess } from "@/lib/pickAccess";
import { sessionUser } from "@/lib/sessionUser";

export async function pickPageAccess(): Promise<PickAccess> {
  if (!authRequired()) return pickAccessForRole(null, false);
  const session = await sessionUser();
  if (!session) return pickAccessForRole(null, true);
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") return pickAccessForRole(null, true);
  return pickAccessForRole(user.role, true);
}
