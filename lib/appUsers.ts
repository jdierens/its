import { authRequired } from "@/lib/authRequired";
import { errorText } from "@/lib/errors";
import type { AppRole, AppStatus } from "@/lib/authDomain";
import { getSupabase } from "@/lib/supabase";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  status: AppStatus;
  createdAt: string;
  approvedBy: string | null;
};

type AppUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  created_at: string;
  approved_by: string | null;
};

function asRole(value: string): AppRole {
  if (value === "admin" || value === "staff" || value === "read_only") return value;
  return "read_only";
}

function asStatus(value: string): AppStatus {
  if (value === "pending" || value === "approved" || value === "disabled") return value;
  return "pending";
}

function toUser(row: AppUserRow): AppUser {
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

export async function fetchCurrentAppUser(): Promise<AppUser | null> {
  if (!authRequired()) return null;
  const supabase = await getSupabase();
  const { data: claims, error: claimError } = await supabase.auth.getClaims();
  if (claimError || !claims?.claims?.sub) return null;
  const { data, error } = await supabase.from("app_users").select("id, email, name, role, status, created_at, approved_by").eq("id", claims.claims.sub).maybeSingle();
  if (error) throw new Error(errorText(error));
  if (!data) return null;
  return toUser(data as AppUserRow);
}

export async function fetchAppUsers(): Promise<AppUser[]> {
  if (!authRequired()) return [];
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("app_users")
    .select("id, email, name, role, status, created_at, approved_by")
    .order("email");
  if (error) throw new Error(errorText(error));
  return ((data ?? []) as AppUserRow[]).map(toUser);
}

export async function setAppUser(id: string, role: AppRole, status: AppStatus): Promise<void> {
  if (!authRequired()) throw new Error("Sign-in is turned off.");
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("set_app_user", {
    p_id: id,
    p_role: role,
    p_status: status,
  });
  if (error) throw new Error(errorText(error));
}
