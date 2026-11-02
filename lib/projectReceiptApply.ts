export const RECEIPT_PROJECT_OWNER_MIGRATION =
  "supabase/migrations/20261102190000_receipt_project_owner.sql";

export type ProjectReceiptApplyField = "vendor" | "consignment";

/** unchanged: the value did not change. save: keep it on this line and do not ask. prompt: other lines on this project already exist. */
export type ProjectReceiptApplyDecision = "unchanged" | "save" | "prompt";

/**
 * Whether assigning a vendor or consignment flag on one receiving line should
 * ask to copy that value onto the other receipts already entered for the same project.
 * A blank project is not a project, so those lines are never included.
 */
export function projectReceiptApplyDecision(input: {
  project: string | null | undefined;
  otherLineCount: number;
  changed: boolean;
}): ProjectReceiptApplyDecision {
  if (!input.changed) return "unchanged";
  const project = (input.project ?? "").trim();
  if (!project) return "save";
  if (!Number.isFinite(input.otherLineCount) || input.otherLineCount < 1) return "save";
  return "prompt";
}

export function projectReceiptApplySummary(input: {
  field: ProjectReceiptApplyField;
  project: string;
  vendorName?: string;
  consigned?: boolean;
}): string {
  const project = input.project.trim() || "this project";
  if (input.field === "vendor") {
    const name = (input.vendorName ?? "").trim() || "this vendor";
    return `Apply ${name} to the other receipts on ${project}? This line keeps that vendor either way.`;
  }
  const value = input.consigned ? "consigned" : "not consigned";
  return `Apply ${value} to the other receipts on ${project}? This line keeps that consignment either way.`;
}

/** What receive_into_bin stores: a receipt with no purchase order is consigned. */
export function savedReceiptConsigned(purchaseOrderId: string | null | undefined): boolean {
  return !(purchaseOrderId ?? "").trim();
}

/** True when the consignment checkbox matches the flag receive_into_bin will store on its own. */
export function consignmentFollowsReceipt(consigned: boolean, purchaseOrderId: string | null | undefined): boolean {
  return consigned === savedReceiptConsigned(purchaseOrderId);
}
