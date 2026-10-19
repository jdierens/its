import { isPublicPath } from "@/lib/publicPaths";

export const COMPANY_DOMAIN = "deepdiscountservers.com";

export type AppRole = "admin" | "staff" | "read_only";
export type AppStatus = "pending" | "approved" | "disabled";

export function isCompanyEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase() ?? "";
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return false;
  return normalized.slice(at + 1) === COMPANY_DOMAIN;
}

export function hostedDomain(identity: unknown): string | null {
  if (!identity || typeof identity !== "object") return null;
  const record = identity as { identity_data?: unknown; hd?: unknown };
  const data = record.identity_data && typeof record.identity_data === "object" ? record.identity_data : record;
  const hd = (data as { hd?: unknown }).hd;
  if (typeof hd !== "string") return null;
  const trimmed = hd.trim().toLowerCase();
  return trimmed || null;
}

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/items";
  if (value.startsWith("/login") || value.startsWith("/auth") || value.startsWith("/waiting")) return "/items";
  return value;
}

export type Gate =
  | { type: "allow" }
  | { type: "redirect"; path: string };

/**
 * Session is required everywhere except public paths, the login page, and
 * the OAuth callback. Pending and disabled accounts stay on the waiting page.
 */
export function gateRequest(input: {
  pathname: string;
  email: string | null;
  domain: string | null;
  status: AppStatus | null;
  role: AppRole | null;
}): Gate {
  const path = input.pathname;
  if (isPublicPath(path) || path === "/auth/callback") return { type: "allow" };

  if (!input.email) {
    if (path === "/login") return { type: "allow" };
    return { type: "redirect", path: "/login" };
  }

  if (!isCompanyEmail(input.email) || (input.domain && input.domain !== COMPANY_DOMAIN)) {
    return { type: "redirect", path: "/login?error=domain" };
  }

  const approved = input.status === "approved";
  if (!approved) {
    if (path === "/waiting" || path === "/login" || path === "/auth/sign-out") return { type: "allow" };
    return { type: "redirect", path: "/waiting" };
  }

  if (path === "/login" || path === "/waiting") return { type: "redirect", path: "/items" };
  if (path === "/admin/users" && input.role !== "admin") return { type: "redirect", path: "/items" };
  return { type: "allow" };
}
