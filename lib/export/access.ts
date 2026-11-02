import { readAppUser } from "@/lib/appUserRecord";
import { capabilitiesFor } from "@/lib/capabilities";
import { sessionUser } from "@/lib/sessionUser";

export class ExportDenied extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type ExportActor = {
  id: string;
  email: string;
  role: string;
  canViewFinancials: boolean;
};

/** Admin, staff, and read_only can see prices. Warehouse roles cannot, unless they are a pricing officer. */
export function canViewFinancials(role: string, pricingOfficer = false): boolean {
  return capabilitiesFor({ role, status: "approved", pricingOfficer, authOn: true }).has("can_view_financials");
}

export async function requireExportActor(): Promise<ExportActor> {
  const session = await sessionUser();
  if (!session) throw new ExportDenied("Sign in with an approved account to export.", 401);
  const user = await readAppUser(session.id);
  if (!user || user.status !== "approved") {
    throw new ExportDenied("An approved account is required to export.", 403);
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    canViewFinancials: canViewFinancials(user.role, user.pricing_officer),
  };
}
