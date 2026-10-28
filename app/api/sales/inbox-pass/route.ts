import { NextResponse } from "next/server";
import { errorDetail } from "@/lib/clientActionError";
import { inboxPassBody, inboxPassFailure, inboxPassResult, readInboxWebhookConfig } from "@/lib/inboxPass";
import { salesPageAccess } from "@/lib/salesSession";
import { stockSettingsWritable } from "@/lib/stockAccess";

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
  const detailed = await stockSettingsWritable();
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
    if (response.ok) return NextResponse.json(inboxPassResult(response.status));
    let cause: string | null = null;
    if (detailed) {
      cause = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 240) || null;
    }
    return NextResponse.json({ ok: false, message: inboxPassFailure({ status: response.status, cause, detailed }) }, { status: 502 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: inboxPassFailure({ cause: errorDetail(error), detailed }) },
      { status: 502 },
    );
  }
}
