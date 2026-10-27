/** Trailing QuickBooks customer `(C)` or vendor `(V)` mark, including a space before it. */
const QBO_PARTY_SUFFIX = /\s*\([CV]\)$/i;

/**
 * Company name for a customer- or vendor-facing document.
 * QuickBooks display names keep `(C)` and `(V)` in the app. Every printed name drops that trailing mark.
 */
export function documentPartyName(name: string): string {
  let current = name.trim();
  while (QBO_PARTY_SUFFIX.test(current)) {
    current = current.replace(QBO_PARTY_SUFFIX, "").trim();
  }
  return current;
}
