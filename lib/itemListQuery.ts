import { alnumQueryAlternatives } from "@/lib/itemAlnum";
import { scanSearchNote, scanTokensInSearchOrder } from "@/lib/receivingScan";

/** The single token the items list searches. The box and the address keep the full text. */
export function itemListQueryToken(q: string): string {
  return scanTokensInSearchOrder(q)[0] ?? "";
}

/**
 * One items-list token per `|` alternative.
 * Empty segments are ignored. Inside one alternative, the longest word still wins.
 */
export function itemListQueryTokens(q: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const alternative of alnumQueryAlternatives(q)) {
    const token = itemListQueryToken(alternative);
    const key = token.toLowerCase();
    if (!token || seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  return tokens;
}

function noteForAlternative(alternative: string): string | null {
  const tokens = scanTokensInSearchOrder(alternative);
  return scanSearchNote({ token: tokens[0] ?? null, tried: tokens, found: true });
}

/** Names the token that was searched when one alternative has more than one word. */
export function itemListSearchNote(q: string): string | null {
  const notes = alnumQueryAlternatives(q)
    .map((alternative) => noteForAlternative(alternative))
    .filter((note): note is string => Boolean(note));
  return notes.length > 0 ? notes.join(" ") : null;
}
