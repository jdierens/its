import { capabilitiesFor } from "@/lib/capabilities";

export type QuoteReviewAccess = {
  canEdit: boolean;
  canView: boolean;
};

/**
 * Quote reviews are prices. Viewing is can_view_financials. Creating and
 * editing is can_edit_financials (admin and staff). read_only and a pricing
 * officer can view. Warehouse roles have neither, so they do not open the page.
 * With sign-in off, the open app can edit.
 */
export function quoteReviewAccessForRole(
  role: string | null,
  authOn: boolean,
  pricingOfficer = false,
): QuoteReviewAccess {
  const caps = capabilitiesFor({ role, status: "approved", pricingOfficer, authOn });
  if (authOn && !role) return { canEdit: false, canView: false };
  return {
    canEdit: caps.has("can_edit_financials"),
    canView: caps.has("can_view_financials"),
  };
}
