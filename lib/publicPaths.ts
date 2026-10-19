/**
 * Paths that must stay reachable with no sign-in.
 * ITS has no login yet. When Google sign-in is added, middleware.ts must
 * keep these paths out of the auth check.
 * /privacy and /terms stay public for the Intuit app questionnaire.
 * /api/ebay/callback is the browser return from eBay OAuth.
 * /api/ebay/account-deletion is called by eBay's servers for the marketplace
 * account deletion challenge and notifications. eBay has no Google session.
 */
export const PUBLIC_PATHS = [
  "/privacy",
  "/terms",
  "/api/ebay/callback",
  "/api/ebay/account-deletion",
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
