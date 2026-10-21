import type { AppRole, AppStatus } from "@/lib/authDomain";
import { errorText } from "@/lib/errors";
import { requireServiceSupabase } from "@/lib/supabaseAdmin";

const COMPANY_EMAIL = /^[^\s@]+@deepdiscountservers\.com$/;

export type StoredAppUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  created_at: string;
  approved_by: string | null;
};

const COLUMNS = "id, email, name, role, status, created_at, approved_by";

function asStored(row: Record<string, unknown>): StoredAppUser {
  return {
    id: String(row.id),
    email: String(row.email),
    name: row.name == null ? null : String(row.name),
    role: String(row.role),
    status: String(row.status),
    created_at: String(row.created_at),
    approved_by: row.approved_by == null ? null : String(row.approved_by),
  };
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
  if (input.nextRole !== "admin" && input.nextRole !== "staff" && input.nextRole !== "read_only") {
    return "Role must be admin, staff, or read_only.";
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

export async function readAppUser(id: string): Promise<StoredAppUser | null> {
  const supabase = requireServiceSupabase();
  const { data, error } = await supabase.from("app_users").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(errorText(error));
  if (!data) return null;
  return asStored(data as Record<string, unknown>);
}

async function readAppUserByEmail(email: string): Promise<StoredAppUser | null> {
  const supabase = requireServiceSupabase();
  const { data, error } = await supabase.from("app_users").select(COLUMNS).eq("email", email).maybeSingle();
  if (error) throw new Error(errorText(error));
  if (!data) return null;
  return asStored(data as Record<string, unknown>);
}

export async function listAppUsers(): Promise<StoredAppUser[]> {
  const supabase = requireServiceSupabase();
  const { data, error } = await supabase.from("app_users").select(COLUMNS).order("email");
  if (error) throw new Error(errorText(error));
  return ((data ?? []) as Record<string, unknown>[]).map(asStored);
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
      const moved = await supabase.from("app_users").update({ id: input.id }).eq("id", byEmail.id).select(COLUMNS).maybeSingle();
      if (moved.error) throw new Error(errorText(moved.error));
      row = moved.data ? asStored(moved.data as Record<string, unknown>) : await readAppUserByEmail(email);
    } else {
      row = byEmail;
    }
  }

  if (!row) {
    const inserted = await supabase
      .from("app_users")
      .insert({ id: input.id, email, name, role: "read_only", status: "pending" })
      .select(COLUMNS)
      .single();
    if (inserted.error) {
      row = (await readAppUser(input.id)) ?? (await readAppUserByEmail(email));
      if (!row) throw new Error(errorText(inserted.error));
    } else {
      row = asStored(inserted.data as Record<string, unknown>);
    }
  } else if (name && (row.name == null || row.name.trim() === "")) {
    const named = await supabase.from("app_users").update({ name }).eq("id", row.id).select(COLUMNS).single();
    if (named.error) throw new Error(errorText(named.error));
    row = asStored(named.data as Record<string, unknown>);
  }

  return row;
}

export async function updateAppUser(input: {
  actorId: string;
  id: string;
  role: AppRole;
  status: AppStatus;
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

  const patch: { role: AppRole; status: AppStatus; approved_by?: string } = {
    role: input.role,
    status: input.status,
  };
  if (input.status === "approved" && current.status !== "approved") patch.approved_by = input.actorId;
  const updated = await supabase.from("app_users").update(patch).eq("id", input.id);
  if (updated.error) throw new Error(errorText(updated.error));
}
