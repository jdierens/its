import { pickAccessForRole } from "@/lib/pickAccess";

export type PackAccess = {
  canPack: boolean;
};

/** Packing uses the same roles as picking. read_only can look and cannot change bins. */
export function packAccessForRole(role: string | null, authOn: boolean): PackAccess {
  return { canPack: pickAccessForRole(role, authOn).canPick };
}
