export type PlaidAccountView = {
  id: string;
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

export type PlaidItemView = {
  id: string;
  itemId: string;
  institutionId: string | null;
  institutionName: string | null;
  status: "active" | "error" | "login_required";
  environment: "sandbox" | "production";
  errorCode: string | null;
  errorMessage: string | null;
  transactionsUpdateStatus: string | null;
  updateStatusLabel: string | null;
  consentExpirationTime: string | null;
  connectedBy: string | null;
  connectedAt: string;
  lastSyncedAt: string | null;
  accounts: PlaidAccountView[];
};

export type PlaidTransactionView = {
  id: string;
  itemId: string;
  accountId: string;
  accountName: string | null;
  mask: string | null;
  amount: number;
  statementAmount: number;
  currencyCode: string | null;
  postedOn: string;
  name: string | null;
  merchantName: string | null;
  pending: boolean;
  paymentChannel: string | null;
  category: string | null;
};

export type PlaidLogView = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  entity: string;
  direction: string;
  status: string;
  message: string | null;
};

export type PlaidStatus = {
  configured: boolean;
  environment: "sandbox" | "production" | null;
  serviceRole: boolean;
  available: boolean;
  canEdit: boolean;
  denied: boolean;
  webhookUrl: string | null;
  redirectUri: string | null;
  historyDays: number;
  message: string | null;
  items: PlaidItemView[];
  transactions: PlaidTransactionView[];
  logs: PlaidLogView[];
};

export type ItemRow = {
  id: string;
  item_id: string;
  access_token: string;
  environment: string;
  institution_id: string | null;
  institution_name: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  transactions_cursor: string | null;
  transactions_update_status: string | null;
  consent_expiration_time: string | null;
  webhook_url: string | null;
  connected_by: string | null;
  connected_at: string;
  last_synced_at: string | null;
};

export type AccountRow = {
  id: string;
  plaid_item_id: string;
  account_id: string;
  name: string | null;
  official_name: string | null;
  mask: string | null;
  account_type: string | null;
  subtype: string | null;
  currency_code: string | null;
  current_balance: number | string | null;
  available_balance: number | string | null;
};

export type TransactionRow = {
  id: string;
  plaid_item_id: string;
  account_id: string;
  amount: number | string;
  currency_code: string | null;
  posted_on: string;
  name: string | null;
  merchant_name: string | null;
  pending: boolean;
  payment_channel: string | null;
  category: { primary?: string; detailed?: string | null } | null;
};

const SECRET_KEYS = ["access_token", "transactions_cursor", "public_token", "link_token"] as const;

export function publicItem(row: ItemRow, accounts: PlaidAccountView[]): PlaidItemView {
  const status = row.status === "error" || row.status === "login_required" ? row.status : "active";
  const environment = row.environment === "production" ? "production" : "sandbox";
  return {
    id: row.id,
    itemId: row.item_id,
    institutionId: row.institution_id,
    institutionName: row.institution_name,
    status,
    environment,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    transactionsUpdateStatus: row.transactions_update_status,
    updateStatusLabel: null,
    consentExpirationTime: row.consent_expiration_time,
    connectedBy: row.connected_by,
    connectedAt: row.connected_at,
    lastSyncedAt: row.last_synced_at,
    accounts,
  };
}

export function exposesSecret(value: unknown): boolean {
  return JSON.stringify(value).split('"').some((part) => SECRET_KEYS.some((key) => part === key));
}
