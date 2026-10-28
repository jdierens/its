import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import { packAccessForRole, type PackAccess } from "@/lib/packAccess";
import { sessionUser } from "@/lib/sessionUser";

export async function packPageAccess(): Promise<PackAccess> {
  if (!authRequired()) return packAccessForRole(null, false);
  const session = await sessionUser();
  if (!session) return packAccessForRole(null, true);
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") return packAccessForRole(null, true);
  return packAccessForRole(user.role, true);
}
