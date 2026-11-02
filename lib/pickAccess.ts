import { capabilitiesFor } from "@/lib/capabilities";

export type PickAccess = {
  canPick: boolean;
};

/** Logging a pick is can_log_picks. read_only can open the sheet and cannot move stock. */
export function pickAccessForRole(role: string | null, authOn: boolean): PickAccess {
  if (authOn && !role) return { canPick: false };
  return { canPick: capabilitiesFor({ role, status: "approved", authOn }).has("can_log_picks") };
}
