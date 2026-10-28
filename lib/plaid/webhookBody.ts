export type PlaidWebhookEvent = {
  webhookType: string;
  webhookCode: string;
  itemId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export function parsePlaidWebhook(raw: string): PlaidWebhookEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const webhookType = typeof record.webhook_type === "string" ? record.webhook_type : "";
  const webhookCode = typeof record.webhook_code === "string" ? record.webhook_code : "";
  if (!webhookType || !webhookCode) return null;
  const error = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : null;
  const errorMessage = error && typeof error.error_message === "string" ? error.error_message.slice(0, 300) : null;
  return {
    webhookType,
    webhookCode,
    itemId: typeof record.item_id === "string" && record.item_id.trim() ? record.item_id : null,
    errorCode: error && typeof error.error_code === "string" ? error.error_code : null,
    errorMessage,
  };
}
