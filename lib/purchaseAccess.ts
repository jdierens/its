import { capabilitiesFor } from "@/lib/capabilities";

export type PurchaseAccess = {
  canEdit: boolean;
  canViewMoney: boolean;
};

/**
 * Creating, entering, and approving a purchase order is can_edit_financials.
 * Seeing costs is can_view_financials. A pricing officer can see costs and
 * cannot approve the order. Warehouse roles see quantities only.
 */
export function purchaseAccessForRole(
  role: string | null,
  authOn: boolean,
  pricingOfficer = false,
): PurchaseAccess {
  const caps = capabilitiesFor({ role, status: "approved", pricingOfficer, authOn });
  if (authOn && !role) return { canEdit: false, canViewMoney: false };
  return {
    canEdit: caps.has("can_edit_financials"),
    canViewMoney: caps.has("can_view_financials"),
  };
}
