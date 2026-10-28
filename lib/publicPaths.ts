/**
 * Paths that must stay reachable with no sign-in.
 * middleware.ts returns these paths before the session check.
 * /privacy and /terms stay public for the Intuit app questionnaire.
 * /api/ebay/callback is the browser return from eBay OAuth.
 * /api/ebay/account-deletion is called by eBay's servers for the marketplace
 * account deletion challenge and notifications. eBay has no Google session.
 * /api/qbo/callback is the browser return from QuickBooks OAuth.
 * /api/plaid/webhook is called by Plaid's servers. Plaid has no Google session.
 * /login and /auth/callback are how a person gets a session, so they are
 * reached with no session, but they are not listed here. The gate allows them.
 */
export const PUBLIC_PATHS = [
  "/privacy",
  "/terms",
  "/api/ebay/callback",
  "/api/ebay/account-deletion",
  "/api/qbo/callback",
  "/api/plaid/webhook",
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
