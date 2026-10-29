/** Payment methods a person can choose. Legacy codes stay in so_payment_methods for old orders. */

export const NON_EBAY_PAYMENT_METHODS = [
  { code: "ach", label: "ACH" },
  { code: "wire", label: "Wire" },
  { code: "paypal", label: "PayPal" },
  { code: "zelle", label: "Zelle" },
] as const;

export const EBAY_PAYMENT_METHOD = { code: "ebay", label: "eBay" } as const;

export function paymentMethodChoices(input: {
  ebay: boolean;
  current: string;
  known?: { code: string; label: string }[];
}): { code: string; label: string }[] {
  if (input.ebay) return [EBAY_PAYMENT_METHOD];
  const choices: { code: string; label: string }[] = [...NON_EBAY_PAYMENT_METHODS];
  const current = input.current.trim();
  if (!current || current === EBAY_PAYMENT_METHOD.code || choices.some((row) => row.code === current)) return choices;
  const known = input.known?.find((row) => row.code === current);
  choices.push({ code: current, label: known?.label || current });
  return choices;
}
