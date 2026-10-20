import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";

// React strict mode runs the new-item effect twice. Reuse one reservation
// for that second call. A later visit starts a new reservation.
const REUSE_MS = 1000;

type Slot<T> = { at: number; value: T };

let cached: Slot<Promise<string>> | null = null;

export function cachedReservation<T>(
  slot: Slot<T> | null,
  now: number,
  create: () => T,
  reuseMs = REUSE_MS,
): { slot: Slot<T>; value: T } {
  if (slot && now - slot.at < reuseMs) return { slot, value: slot.value };
  const value = create();
  return { slot: { at: now, value }, value };
}

export async function fetchReservedSku(): Promise<string> {
  const { data, error } = await (await getSupabase()).rpc("reserve_item_sku");
  if (error) throw new Error(errorText(error));
  if (typeof data !== "string" || data.length === 0) {
    throw new Error("Could not assign a SKU.");
  }
  return data;
}

export function reserveNewItemSku(now = Date.now()): Promise<string> {
  const next = cachedReservation(cached, now, () =>
    fetchReservedSku().catch((error: unknown) => {
      cached = null;
      throw error;
    }),
  );
  cached = next.slot;
  return next.value;
}

export function clearNewItemSku(): void {
  cached = null;
}
