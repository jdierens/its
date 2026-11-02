import type { AppRole, AppStatus } from "@/lib/authDomain";
import { errorText } from "@/lib/errors";
import { initialsFromPerson, twoLetterInitials } from "@/lib/stockReceive";
import { requireServiceSupabase } from "@/lib/supabaseAdmin";

const COMPANY_EMAIL = /^[^\s@]+@deepdiscountservers\.com$/;

export type StoredAppUser = {
  id: string;
  email: string;
  name: string | null;
  initials: string;
  role: string;
  status: string;
  pricing_officer: boolean;
  created_at: string;
  approved_by: string | null;
};

const COLUMNS = "id, email, name, initials, role, status, pricing_officer, created_at, approved_by";
const LEGACY_COLUMNS = "id, email, name, initials, role, status, created_at, approved_by";

export const KNOWN_ROLES = ["admin", "staff", "warehouse_manager", "warehouse_clerk", "read_only"] as const;

export const LAST_PRICING_OFFICER_ERROR = "Assign another pricing officer before removing the last one.";

function asStored(row: Record<string, unknown>): StoredAppUser {
  return {
    id: String(row.id),
    email: String(row.email),
    name: row.name == null ? null : String(row.name),
    initials: String(row.initials ?? ""),
    role: String(row.role),
    status: String(row.status),
    pricing_officer: row.pricing_officer === true,
    created_at: String(row.created_at),
    approved_by: row.approved_by == null ? null : String(row.approved_by),
  };
}

export function missingPricingOfficerColumn(error: { message?: string } | null): boolean {
  const message = error?.message ?? "";
  return /pricing_officer/.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

export function appUserChangeError(input: {
  actor: { id: string; role: string; status: string } | null;
  current: { id: string; role: string; status: string };
  nextRole: string;
  nextStatus: string;
  otherApprovedAdmins: number;
}): string | null {
  const { actor, current } = input;
  if (!actor || actor.role !== "admin" || actor.status !== "approved") {
    return "Only an approved admin can change users.";
  }
  if (!KNOWN_ROLES.includes(input.nextRole as (typeof KNOWN_ROLES)[number])) {
    return "Role must be admin, staff, warehouse manager, warehouse clerk, or read_only.";
  }
  if (input.nextStatus !== "pending" && input.nextStatus !== "approved" && input.nextStatus !== "disabled") {
    return "Status must be pending, approved, or disabled.";
  }
  if (current.id === actor.id && (input.nextRole !== "admin" || input.nextStatus !== "approved")) {
    return "You cannot remove your own admin access.";
  }
  if (
    current.role === "admin" &&
    current.status === "approved" &&
    input.otherApprovedAdmins === 0 &&
    (input.nextRole !== "admin" || input.nextStatus !== "approved")
  ) {
    return "Keep at least one approved admin.";
  }
  return null;
}

export function pricingOfficerRemovalError(input: {
  currentOfficer: boolean;
  currentStatus: string;
  nextOfficer: boolean;
  nextStatus: string;
  otherApprovedOfficers: number;
}): string | null {
  const held = input.currentOfficer && input.currentStatus === "approved";
  const keeps = input.nextOfficer && input.nextStatus === "approved";
  if (held && !keeps && input.otherApprovedOfficers === 0) return LAST_PRICING_OFFICER_ERROR;
  return null;
}

type UserQuery = {
  eq?: { column: string; value: string };
  order?: string;
  maybeSingle?: boolean;
  single?: boolean;
};

async function loadUsers(query: UserQuery): Promise<StoredAppUser | StoredAppUser[] | null> {
  const supabase = requireServiceSupabase();
  const run = async (columns: string) => {
    let request = supabase.from("app_users").select(columns);
    if (query.eq) request = request.eq(query.eq.column, query.eq.value);
    if (query.order) request = request.order(query.order);
    if (query.maybeSingle) return request.maybeSingle();
    if (query.single) return request.single();
    return request;
  };
  const first = await run(COLUMNS);
  if (first.error && missingPricingOfficerColumn(first.error)) {
    const legacy = await run(LEGACY_COLUMNS);
    if (legacy.error) throw new Error(errorText(legacy.error));
    if (query.maybeSingle || query.single) {
      return legacy.data ? asStored(legacy.data as unknown as Record<string, unknown>) : null;
    }
    return ((legacy.data ?? []) as unknown as Record<string, unknown>[]).map(asStored);
  }
  if (first.error) throw new Error(errorText(first.error));
  if (query.maybeSingle || query.single) {
    return first.data ? asStored(first.data as unknown as Record<string, unknown>) : null;
  }
  return ((first.data ?? []) as unknown as Record<string, unknown>[]).map(asStored);
}

export async function readAppUser(id: string): Promise<StoredAppUser | null> {
  return (await loadUsers({ eq: { column: "id", value: id }, maybeSingle: true })) as StoredAppUser | null;
}

async function readAppUserByEmail(email: string): Promise<StoredAppUser | null> {
  return (await loadUsers({ eq: { column: "email", value: email }, maybeSingle: true })) as StoredAppUser | null;
}

export async function listAppUsers(): Promise<StoredAppUser[]> {
  return (await loadUsers({ order: "email" })) as StoredAppUser[];
}

/**
 * Links a Google account to app_users. A seeded email keeps its role and
 * status. A new email starts pending. Uses the service role because
 * ensure_app_user reads auth.uid(), which is null for that role.
 */
export async function ensureAppUser(input: {
  id: string;
  email: string;
  name: string | null;
}): Promise<StoredAppUser> {
  const email = input.email.trim().toLowerCase();
  if (!COMPANY_EMAIL.test(email)) {
    throw new Error("Sign-in is limited to @deepdiscountservers.com");
  }
  const name = input.name?.trim() ? input.name.trim() : null;
  const supabase = requireServiceSupabase();

  let row = await readAppUser(input.id);
  if (!row) {
    const byEmail = await readAppUserByEmail(email);
    if (byEmail && byEmail.id !== input.id) {
      const moved = await supabase.from("app_users").update({ id: input.id }).eq("id", byEmail.id);
      if (moved.error) throw new Error(errorText(moved.error));
      row = await readAppUser(input.id);
    } else {
      row = byEmail;
    }
  }

  if (!row) {
    const inserted = await supabase
      .from("app_users")
      .insert({
        id: input.id,
        email,
        name,
        initials: initialsFromPerson(name, email),
        role: "read_only",
        status: "pending",
      })
      .select("id")
      .single();
    if (inserted.error) {
      row = (await readAppUser(input.id)) ?? (await readAppUserByEmail(email));
      if (!row) throw new Error(errorText(inserted.error));
    } else {
      row = await readAppUser(input.id);
      if (!row) throw new Error(errorText(inserted.error));
    }
  } else if (name && (row.name == null || row.name.trim() === "")) {
    const named = await supabase.from("app_users").update({ name }).eq("id", row.id);
    if (named.error) throw new Error(errorText(named.error));
    row = (await readAppUser(row.id)) ?? row;
  }

  return row;
}

export async function updateAppUser(input: {
  actorId: string;
  id: string;
  role: AppRole;
  status: AppStatus;
  pricingOfficer: boolean;
}): Promise<void> {
  const supabase = requireServiceSupabase();
  const actor = await readAppUser(input.actorId);
  const current = await readAppUser(input.id);
  if (!current) throw new Error("Unknown user.");

  const counted = await supabase
    .from("app_users")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("status", "approved")
    .neq("id", input.id);
  if (counted.error) throw new Error(errorText(counted.error));

  const message = appUserChangeError({
    actor,
    current,
    nextRole: input.role,
    nextStatus: input.status,
    otherApprovedAdmins: counted.count ?? 0,
  });
  if (message) throw new Error(message);

  const officers = await supabase
    .from("app_users")
    .select("id", { count: "exact", head: true })
    .eq("pricing_officer", true)
    .eq("status", "approved")
    .neq("id", input.id);
  if (officers.error) {
    if (missingPricingOfficerColumn(officers.error)) {
      throw new Error("Apply supabase/migrations/20261102203000_warehouse_roles.sql before assigning a pricing officer.");
    }
    throw new Error(errorText(officers.error));
  }
  const officerMessage = pricingOfficerRemovalError({
    currentOfficer: current.pricing_officer,
    currentStatus: current.status,
    nextOfficer: input.pricingOfficer,
    nextStatus: input.status,
    otherApprovedOfficers: officers.count ?? 0,
  });
  if (officerMessage) throw new Error(officerMessage);

  const patch: { role: AppRole; status: AppStatus; pricing_officer: boolean; approved_by?: string } = {
    role: input.role,
    status: input.status,
    pricing_officer: input.pricingOfficer,
  };
  if (input.status === "approved" && current.status !== "approved") patch.approved_by = input.actorId;
  const updated = await supabase.from("app_users").update(patch).eq("id", input.id);
  if (updated.error) throw new Error(errorText(updated.error));
}

export async function updateAppUserInitials(input: {
  actorId: string;
  id: string;
  initials: string;
}): Promise<void> {
  const supabase = requireServiceSupabase();
  const actor = await readAppUser(input.actorId);
  if (!actor || actor.role !== "admin" || actor.status !== "approved") {
    throw new Error("Only an approved admin can change users.");
  }
  const initials = twoLetterInitials(input.initials);
  if (!initials) throw new Error("Operator initials must be 2 letters.");
  const current = await readAppUser(input.id);
  if (!current) throw new Error("Unknown user.");
  const updated = await supabase.from("app_users").update({ initials }).eq("id", input.id);
  if (updated.error) throw new Error(errorText(updated.error));
}
