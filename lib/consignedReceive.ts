export const CONSIGNED_RECEIVE_MIGRATION = "supabase/migrations/20261027233000_consigned_receive.sql";

export const CONSIGNED_VENDOR_REQUIRED =
  "Choose a vendor. A receipt without a purchase order is consigned.";

export type ReceiveConsignment =
  | { ok: true; purchaseOrderId: string | null; vendorId: string | null; consigned: boolean }
  | { ok: false; message: string };

/** A receipt with no purchase order is consigned and has to name a vendor. A purchase order supplies its own vendor. */
export function receiveConsignment(input: {
  purchaseOrderId?: string | null;
  vendorId?: string | null;
}): ReceiveConsignment {
  const purchaseOrderId = input.purchaseOrderId?.trim() || null;
  const vendorId = input.vendorId?.trim() || null;
  if (!purchaseOrderId && !vendorId) {
    return { ok: false, message: CONSIGNED_VENDOR_REQUIRED };
  }
  return { ok: true, purchaseOrderId, vendorId, consigned: purchaseOrderId == null };
}

export function receivingVendorStorageKey(projectStorageKey: string): string {
  return `${projectStorageKey}.vendor`;
}

export function readStoredVendor(storage: Pick<Storage, "getItem">, key: string): string | null {
  try {
    const value = storage.getItem(key);
    const trimmed = value?.trim() ?? "";
    return trimmed || null;
  } catch {
    return null;
  }
}

export function writeStoredVendor(storage: Pick<Storage, "setItem">, key: string, vendorId: string): void {
  try {
    storage.setItem(key, vendorId);
  } catch {
    // Private mode and blocked storage still leave the field editable.
  }
}
