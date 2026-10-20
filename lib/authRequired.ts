/**
 * Sign-in is enforced only when AUTH_REQUIRED is exactly "true".
 * The client sees the same flag as NEXT_PUBLIC_AUTH_REQUIRED, copied in
 * next.config.ts from AUTH_REQUIRED at build time. Any other value, including
 * unset, leaves the app open.
 */
export function authRequired(): boolean {
  return process.env.AUTH_REQUIRED === "true" || process.env.NEXT_PUBLIC_AUTH_REQUIRED === "true";
}
