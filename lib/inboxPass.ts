/** Winston routine "On-demand inbox PO pass" (folder on-demand-inbox-po-pass). */
export const INBOX_PASS_ROUTINE = "on-demand-inbox-po-pass";

export const INBOX_PASS_MISSING =
  "Email order check is not configured. Set WINSTON_INBOX_WEBHOOK_URL and WINSTON_INBOX_WEBHOOK_KEY on the server.";

export const INBOX_PASS_STARTED =
  "Winston is checking incoming orders. New drafts show up on this list when the pass finishes. Nothing is approved.";

export const INBOX_PASS_FAILED = "Winston did not start the inbox pass.";

export type InboxWebhookConfig = { url: string; key: string };

/** Server env only. The key is the Grok Bot webhook sender key, sent as Authorization: Bearer. */
export function readInboxWebhookConfig(env: Record<string, string | undefined>): InboxWebhookConfig | { error: string } {
  const url = env.WINSTON_INBOX_WEBHOOK_URL?.trim() ?? "";
  const key = env.WINSTON_INBOX_WEBHOOK_KEY?.trim() ?? "";
  if (!url || !key) return { error: INBOX_PASS_MISSING };
  return { url, key };
}

export function inboxPassBody(): string {
  return JSON.stringify({ source: "its", routine: INBOX_PASS_ROUTINE });
}

/** 200 means the routine started. It does not mean the inbox pass has finished. */
export function inboxPassResult(status: number): { ok: boolean; message: string } {
  if (status === 200) return { ok: true, message: INBOX_PASS_STARTED };
  return { ok: false, message: INBOX_PASS_FAILED };
}

/** Admins see the webhook status and cause. Other roles keep the generic sentence. */
export function inboxPassFailure(input: { status?: number; cause?: string | null; detailed: boolean }): string {
  if (!input.detailed) return INBOX_PASS_FAILED;
  const parts = [INBOX_PASS_FAILED];
  if (typeof input.status === "number") parts.push(`HTTP ${input.status}.`);
  const cause = input.cause?.replace(/\s+/g, " ").trim().slice(0, 240) ?? "";
  if (cause) parts.push(cause);
  return parts.join(" ");
}
