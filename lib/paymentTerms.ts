/** Payment terms stored on a purchase order. Extend this list in one place. */
export const PAYMENT_TERMS = ["Net0", "Net1", "Net7", "Net10", "Net14", "Net15", "Net30"] as const;

export type PaymentTerm = (typeof PAYMENT_TERMS)[number];

const ALLOWED = new Set<string>(PAYMENT_TERMS);

export function parsePaymentTerm(value: string): PaymentTerm | "invalid" {
  const trimmed = value.trim();
  if (!ALLOWED.has(trimmed)) return "invalid";
  return trimmed as PaymentTerm;
}
