export class PlaidCallError extends Error {
  code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = "PlaidCallError";
    this.code = code;
  }
}

type PlaidErrorBody = {
  error_code?: unknown;
  error_message?: unknown;
  display_message?: unknown;
};

export function readPlaidError(error: unknown): { code: string | null; message: string } {
  if (error instanceof PlaidCallError) return { code: error.code, message: error.message };
  const body = plaidErrorBody(error);
  if (body) {
    const code = typeof body.error_code === "string" ? body.error_code : null;
    const display = typeof body.display_message === "string" ? body.display_message.trim() : "";
    const message = typeof body.error_message === "string" ? body.error_message.trim() : "";
    return { code, message: display || message || "Plaid request failed." };
  }
  if (error instanceof Error && error.message) return { code: null, message: error.message };
  return { code: null, message: "Plaid request failed." };
}

export function plaidSchemaMissing(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  if ((code === "42P01" || code === "PGRST205") && /plaid_/i.test(message)) return true;
  return /plaid_(items|accounts|transactions|sync_log)/i.test(message) && /schema cache|does not exist|could not find/i.test(message);
}

function plaidErrorBody(error: unknown): PlaidErrorBody | null {
  if (!error || typeof error !== "object" || !("response" in error)) return null;
  const response = (error as { response?: { data?: unknown } }).response;
  const data = response?.data;
  if (!data || typeof data !== "object") return null;
  return data as PlaidErrorBody;
}
