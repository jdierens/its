export const LENS_LIMIT = 8;
export const LENS_WINDOW_MS = 10 * 60 * 1000;

export function takeLensSlot(input: {
  now: number;
  history: number[];
  windowMs?: number;
  limit?: number;
}): { ok: boolean; history: number[] } {
  const windowMs = input.windowMs ?? LENS_WINDOW_MS;
  const limit = input.limit ?? LENS_LIMIT;
  const history = input.history.filter((at) => input.now - at < windowMs);
  if (history.length >= limit) return { ok: false, history };
  return { ok: true, history: [...history, input.now] };
}

const callers = new Map<string, number[]>();

export function allowLensCaller(caller: string, now = Date.now()): boolean {
  const slot = takeLensSlot({ now, history: callers.get(caller) ?? [] });
  callers.set(caller, slot.history);
  return slot.ok;
}
