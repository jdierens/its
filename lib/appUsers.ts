"use server";

import { authRequired } from "@/lib/authRequired";
import { ensureAppUser, listAppUsers, readAppUser, updateAppUser, type StoredAppUser } from "@/lib/appUserRecord";
import type { AppRole, AppStatus } from "@/lib/authDomain";
import { sessionUser } from "@/lib/sessionUser";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  status: AppStatus;
  createdAt: string;
  approvedBy: string | null;
};

function asRole(value: string): AppRole {
  if (value === "admin" || value === "staff" || value === "read_only") return value;
  return "read_only";
}

function asStatus(value: string): AppStatus {
  if (value === "pending" || value === "approved" || value === "disabled") return value;
  return "pending";
}

function toUser(row: StoredAppUser): AppUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? "",
    role: asRole(row.role),
    status: asStatus(row.status),
    createdAt: row.created_at,
    approvedBy: row.approved_by,
  };
}

/** Pending accounts can read their own row. Other data calls cannot. */
export async function fetchCurrentAppUser(): Promise<AppUser | null> {
  if (!authRequired()) return null;
  const session = await sessionUser();
  if (!session) return null;
  const row = await readAppUser(session.id);
  return row ? toUser(row) : null;
}

export async function fetchAppUsers(): Promise<AppUser[]> {
  if (!authRequired()) return [];
  const session = await sessionUser();
  if (!session) throw new Error("Sign in required.");
  const actor = await readAppUser(session.id);
  if (!actor || actor.status !== "approved") throw new Error("This account cannot change data.");
  return (await listAppUsers()).map(toUser);
}

export async function setAppUser(id: string, role: AppRole, status: AppStatus): Promise<void> {
  if (!authRequired()) throw new Error("Sign-in is turned off.");
  const session = await sessionUser();
  if (!session) throw new Error("Sign in required.");
  await updateAppUser({ actorId: session.id, id, role, status });
}
