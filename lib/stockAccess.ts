import { readAppUser } from "@/lib/appUserRecord";
import { authRequired } from "@/lib/authRequired";
import { sessionUser } from "@/lib/sessionUser";
import { initialsFromPerson } from "@/lib/stockReceive";

export async function stockSettingsWritable(): Promise<boolean> {
  if (!authRequired()) return true;
  const session = await sessionUser();
  if (!session) return false;
  const user = await readAppUser(session.id);
  return Boolean(user && user.status === "approved" && user.role === "admin");
}

export async function assertStockAdmin(): Promise<void> {
  if (!(await stockSettingsWritable())) {
    throw new Error("Only an admin can change put-away defaults.");
  }
}

export async function operatorInitials(): Promise<string> {
  if (!authRequired()) return "OP";
  const session = await sessionUser();
  if (!session) throw new Error("Sign in required.");
  const user = await readAppUser(session.id);
  if (user?.initials && /^[A-Z]{2}$/.test(user.initials)) return user.initials;
  return initialsFromPerson(user?.name ?? null, session.email);
}
