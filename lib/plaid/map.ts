export type MappedAccount = {
  accountId: string;
  name: string | null;
  officialName: string | null;
  mask: string | null;
  accountType: string | null;
  subtype: string | null;
  currencyCode: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
};

export type MappedTransaction = {
  transactionId: string;
  accountId: string;
  amount: number;
  currencyCode: string | null;
  postedOn: string;
  name: string | null;
  merchantName: string | null;
  pending: boolean;
  paymentChannel: string | null;
  category: { primary: string; detailed: string | null } | null;
};

export type AccountSource = {
  account_id?: unknown;
  name?: unknown;
  official_name?: unknown;
  mask?: unknown;
  type?: unknown;
  subtype?: unknown;
  balances?: {
    current?: unknown;
    available?: unknown;
    iso_currency_code?: unknown;
    unofficial_currency_code?: unknown;
  } | null;
};

export type TransactionSource = {
  transaction_id?: unknown;
  account_id?: unknown;
  amount?: unknown;
  iso_currency_code?: unknown;
  unofficial_currency_code?: unknown;
  date?: unknown;
  name?: unknown;
  merchant_name?: unknown;
  pending?: unknown;
  payment_channel?: unknown;
  personal_finance_category?: { primary?: unknown; detailed?: unknown } | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function mapAccount(source: AccountSource): MappedAccount | null {
  const accountId = text(source.account_id, 80);
  if (!accountId) return null;
  const balances = source.balances ?? null;
  return {
    accountId,
    name: text(source.name, 200),
    officialName: text(source.official_name, 200),
    mask: text(source.mask, 8),
    accountType: text(source.type, 40),
    subtype: text(source.subtype, 40),
    currencyCode: text(balances?.iso_currency_code, 12) ?? text(balances?.unofficial_currency_code, 12),
    currentBalance: money(balances?.current),
    availableBalance: money(balances?.available),
  };
}

export function mapTransaction(source: TransactionSource): MappedTransaction | null {
  const transactionId = text(source.transaction_id, 128);
  const accountId = text(source.account_id, 80);
  const postedOn = text(source.date, 10);
  const amount = money(source.amount);
  if (!transactionId || !accountId || !postedOn || !DATE.test(postedOn) || amount == null) return null;
  const primary = text(source.personal_finance_category?.primary, 80);
  const detailed = text(source.personal_finance_category?.detailed, 80);
  return {
    transactionId,
    accountId,
    amount,
    currencyCode: text(source.iso_currency_code, 12) ?? text(source.unofficial_currency_code, 12),
    postedOn,
    name: text(source.name, 300),
    merchantName: text(source.merchant_name, 200),
    pending: source.pending === true,
    paymentChannel: text(source.payment_channel, 40),
    category: primary ? { primary, detailed } : null,
  };
}

/** Plaid's positive amount is money out. The screen shows the bank-statement sign. */
export function statementAmount(plaidAmount: number): number {
  if (!Number.isFinite(plaidAmount) || plaidAmount === 0) return 0;
  return -plaidAmount;
}

export function updateStatusLabel(status: string | null): string | null {
  if (status === "NOT_READY") return "Plaid is still preparing transactions.";
  if (status === "INITIAL_UPDATE_COMPLETE") return "Recent transactions are in. Older history is still loading.";
  if (status === "HISTORICAL_UPDATE_COMPLETE") return "Requested history is in.";
  if (status === "TRANSACTIONS_UPDATE_STATUS_UNKNOWN") return "Plaid did not report whether history is complete.";
  return null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function money(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}
