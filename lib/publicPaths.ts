/**
 * Paths that must stay reachable with no sign-in.
 * ITS has no login yet. When Google sign-in is added, middleware.ts must
 * keep these paths out of the auth check so the privacy policy and terms
 * stay public for the Intuit app questionnaire and for anyone who opens them.
 */
export const PUBLIC_PATHS = ["/privacy", "/terms"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
