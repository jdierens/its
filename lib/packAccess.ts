import { pickAccessForRole } from "@/lib/pickAccess";

export type PackAccess = {
  canPack: boolean;
};

/** Packing uses can_log_picks, the same capability as picking. */
export function packAccessForRole(role: string | null, authOn: boolean): PackAccess {
  return { canPack: pickAccessForRole(role, authOn).canPick };
}
