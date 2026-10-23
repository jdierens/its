/** Tokens from a scan, longest first. Equal lengths prefer a token that has both letters and digits. */
export function scanTokensInSearchOrder(raw: string): string[] {
  const tokens = raw.trim().split(/\s+/).filter((token) => token.length > 0);
  return tokens
    .map((token, index) => ({
      token,
      index,
      mixed: /[A-Za-z]/.test(token) && /\d/.test(token),
    }))
    .sort((a, b) => b.token.length - a.token.length || Number(b.mixed) - Number(a.mixed) || a.index - b.index)
    .map((row) => row.token);
}

/** Which token the search used. A single token needs no extra line. */
export function scanSearchNote(input: { token: string | null; tried: readonly string[]; found: boolean }): string | null {
  if (!input.token || input.tried.length < 2) return null;
  if (input.found) return `Searched ${input.token}.`;
  return `Searched ${input.tried.join(", then ")}.`;
}

export function receiptChangeSummary(input: {
  sku: string;
  nextSku: string;
  qty: number;
  nextQty: number;
}): string | null {
  const skuChanged = input.sku.trim() !== input.nextSku.trim();
  const qtyChanged = input.qty !== input.nextQty;
  if (!skuChanged && !qtyChanged) return null;
  const parts: string[] = [];
  if (skuChanged) parts.push(`SKU from ${input.sku.trim() || "blank"} to ${input.nextSku.trim() || "blank"}`);
  if (qtyChanged) parts.push(`qty from ${input.qty} to ${input.nextQty}`);
  return `Change ${parts.join(" and ")}? This posts an adjustment. The bin can't go below 0.`;
}
