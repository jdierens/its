import { fetchReservedSku } from "@/lib/skuServer";

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
