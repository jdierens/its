export type PurchaseAccess = {
  canEdit: boolean;
  canViewMoney: boolean;
};

/**
 * Admin and staff create, edit, and send purchase orders and see costs.
 * read_only can see costs and cannot change the order.
 * Any other role, including a future warehouse role, sees quantities only.
 * While sign-in is off there is no role, and the open app can edit.
 */
export function purchaseAccessForRole(role: string | null, authOn: boolean): PurchaseAccess {
  if (!authOn) return { canEdit: true, canViewMoney: true };
  if (role === "admin" || role === "staff") return { canEdit: true, canViewMoney: true };
  if (role === "read_only") return { canEdit: false, canViewMoney: true };
  return { canEdit: false, canViewMoney: false };
}
