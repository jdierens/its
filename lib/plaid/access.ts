import type { AppRole } from "@/lib/authDomain";

/** Bank feeds follow the other money screens: admin and staff when sign-in is on. */
export function bankFeedAllowed(role: AppRole | null, authOn: boolean): boolean {
  if (!authOn) return true;
  return role === "admin" || role === "staff";
}
