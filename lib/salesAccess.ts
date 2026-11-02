import { capabilitiesFor } from "@/lib/capabilities";

export type SalesAccess = {
  canEdit: boolean;
  canViewMoney: boolean;
};

/**
 * Creating and approving a sales order is can_edit_financials.
 * Seeing prices is can_view_financials. Warehouse roles see parts and quantities.
 */
export function salesAccessForRole(role: string | null, authOn: boolean, pricingOfficer = false): SalesAccess {
  const caps = capabilitiesFor({ role, status: "approved", pricingOfficer, authOn });
  if (authOn && !role) return { canEdit: false, canViewMoney: false };
  return {
    canEdit: caps.has("can_edit_financials"),
    canViewMoney: caps.has("can_view_financials"),
  };
}
