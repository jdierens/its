import { scanSearchNote, scanTokensInSearchOrder } from "@/lib/receivingScan";

/** The single token the items list searches. The box and the address keep the full text. */
export function itemListQueryToken(q: string): string {
  return scanTokensInSearchOrder(q)[0] ?? "";
}

/** Names the token that was searched when the box has more than one word. */
export function itemListSearchNote(q: string): string | null {
  const tokens = scanTokensInSearchOrder(q);
  return scanSearchNote({ token: tokens[0] ?? null, tried: tokens, found: true });
}
