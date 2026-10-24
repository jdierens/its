export type SalesAccess = {
  canEdit: boolean;
  canViewMoney: boolean;
};

/**
 * Admin and staff create and approve sales orders and see prices.
 * read_only can see prices and cannot change the order.
 * Any other role sees parts and quantities only.
 * While sign-in is off there is no role, and the open app can edit.
 */
export function salesAccessForRole(role: string | null, authOn: boolean): SalesAccess {
  if (!authOn) return { canEdit: true, canViewMoney: true };
  if (role === "admin" || role === "staff") return { canEdit: true, canViewMoney: true };
  if (role === "read_only") return { canEdit: false, canViewMoney: true };
  return { canEdit: false, canViewMoney: false };
}
