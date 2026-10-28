import { NextResponse } from "next/server";
import { plaidApi } from "@/lib/plaid/client";
import { readPlaidConfig } from "@/lib/plaid/config";
import { readPlaidError } from "@/lib/plaid/errors";
import { noteItemWebhook, syncByPlaidItemId } from "@/lib/plaid/feed";
import { parsePlaidWebhook } from "@/lib/plaid/webhookBody";
import { plaidWebhookKeyId, verifyPlaidWebhook, type WebhookVerificationKey } from "@/lib/plaid/webhookVerify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const keys = new Map<string, WebhookVerificationKey>();

export async function POST(request: Request) {
  const raw = await request.text();
  const config = readPlaidConfig();
  if (!config) return NextResponse.json({ error: "Plaid is not configured." }, { status: 503 });
  const jwt = request.headers.get("plaid-verification");
  const keyId = plaidWebhookKeyId(jwt);
  if (!jwt || !keyId.ok) {
    return NextResponse.json({ error: keyId.ok ? "Plaid webhook signature is missing." : keyId.reason }, { status: 401 });
  }
  const key = await verificationKey(keyId.kid);
  if (!key) return NextResponse.json({ error: "Plaid webhook key could not be loaded." }, { status: 401 });
  const verified = verifyPlaidWebhook({ jwt, rawBody: raw, key });
  if (!verified.ok) return NextResponse.json({ error: verified.reason }, { status: 401 });

  const event = parsePlaidWebhook(raw);
  if (!event?.itemId) return NextResponse.json({ ok: true });
  try {
    const action = await noteItemWebhook({
      itemId: event.itemId,
      code: event.webhookCode,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
    });
    if (action === "sync") await syncByPlaidItemId(event.itemId);
  } catch (error) {
    const parsed = readPlaidError(error);
    if (parsed.code === "ITEM_LOGIN_REQUIRED") return NextResponse.json({ ok: true });
    return NextResponse.json({ error: "Sync failed." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function verificationKey(kid: string): Promise<WebhookVerificationKey | null> {
  const cached = keys.get(kid);
  if (cached && cached.expired_at == null) return cached;
  const config = readPlaidConfig();
  if (!config) return null;
  try {
    const response = await plaidApi(config).webhookVerificationKeyGet({ key_id: kid });
    const key = response.data.key;
    if (key.expired_at == null) keys.set(kid, key);
    return key;
  } catch {
    return null;
  }
}
