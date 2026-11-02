import { capabilitiesFor } from "@/lib/capabilities";

/** Bank feeds are an integration. The recommended gate is admin only. */
export function bankFeedAllowed(role: string | null, authOn: boolean): boolean {
  if (authOn && !role) return false;
  return capabilitiesFor({ role, status: "approved", authOn }).has("can_manage_integrations");
}
