import { EBAY_ORDER_CUSTOMER_NAME } from "@/lib/ebay/orderMap";

/**
 * eBay's anonymized buyer mailbox. QuickBooks customers created from eBay
 * buyers use this domain. The order pull does not create those rows; it
 * reuses the single customer named eBay Customer.
 */
export const EBAY_MEMBER_EMAIL_SUFFIX = "@members.ebay.com";

/**
 * A customer that came from eBay, not from a sales relationship.
 * True when the email is an eBay member address, or the display name is the
 * order-pull customer. A company whose name merely contains "ebay" stays.
 */
export function isEbaySourcedCustomer(input: {
  displayName?: string | null;
  primaryEmail?: string | null;
}): boolean {
  const name = (input.displayName ?? "").trim().toLowerCase();
  if (name === EBAY_ORDER_CUSTOMER_NAME.toLowerCase()) return true;
  const email = (input.primaryEmail ?? "").trim().toLowerCase();
  return email.endsWith(EBAY_MEMBER_EMAIL_SUFFIX);
}
