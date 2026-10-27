import { NextResponse } from "next/server";
import { INBOX_PASS_FAILED, inboxPassBody, inboxPassResult, readInboxWebhookConfig } from "@/lib/inboxPass";
import { salesPageAccess } from "@/lib/salesSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const access = await salesPageAccess();
  if (!access.canEdit) {
    return NextResponse.json({ ok: false, message: "You cannot check email orders." }, { status: 403 });
  }
  const config = readInboxWebhookConfig(process.env);
  if ("error" in config) {
    return NextResponse.json({ ok: false, message: config.error }, { status: 503 });
  }
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
      },
      body: inboxPassBody(),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const result = inboxPassResult(response.status);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ ok: false, message: INBOX_PASS_FAILED }, { status: 502 });
  }
}
