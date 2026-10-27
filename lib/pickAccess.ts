export type PickAccess = {
  canPick: boolean;
};

/**
 * Recording a pick is for staff, admin, and a future warehouse role.
 * read_only can open the sheet and cannot move stock.
 * While sign-in is off there is no role, and the open app can pick.
 */
export function pickAccessForRole(role: string | null, authOn: boolean): PickAccess {
  if (!authOn) return { canPick: true };
  if (!role || role === "read_only") return { canPick: false };
  return { canPick: true };
}
