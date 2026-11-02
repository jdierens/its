"use server";

import { requireCapability } from "@/lib/actorAccess";
import { authRequired } from "@/lib/authRequired";
import { ensureAppUser, listAppUsers, readAppUser, updateAppUser, updateAppUserInitials, type StoredAppUser } from "@/lib/appUserRecord";
import type { AppRole, AppStatus } from "@/lib/authDomain";
import { sessionUser } from "@/lib/sessionUser";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: AppRole;
  status: AppStatus;
  pricingOfficer: boolean;
  createdAt: string;
  approvedBy: string | null;
};

function asRole(value: string): AppRole {
  if (
    value === "admin" ||
    value === "staff" ||
    value === "read_only" ||
    value === "warehouse_manager" ||
    value === "warehouse_clerk"
  ) {
    return value;
  }
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
    initials: row.initials,
    role: asRole(row.role),
    status: asStatus(row.status),
    pricingOfficer: row.pricing_officer,
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
  await requireCapability("can_manage_users");
  return (await listAppUsers()).map(toUser);
}

export async function setAppUserInitials(id: string, initials: string): Promise<void> {
  if (!authRequired()) throw new Error("Sign-in is turned off.");
  const actor = await requireCapability("can_manage_users");
  if (!actor.id) throw new Error("Sign in required.");
  await updateAppUserInitials({ actorId: actor.id, id, initials });
}

export async function setAppUser(
  id: string,
  role: AppRole,
  status: AppStatus,
  pricingOfficer: boolean,
): Promise<void> {
  if (!authRequired()) throw new Error("Sign-in is turned off.");
  const actor = await requireCapability("can_manage_users");
  if (!actor.id) throw new Error("Sign in required.");
  await updateAppUser({ actorId: actor.id, id, role, status, pricingOfficer });
}
