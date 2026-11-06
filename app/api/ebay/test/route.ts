import { NextResponse } from "next/server";
import { ReconnectError } from "@/lib/ebay/auth";
import { RECONNECT_MESSAGE } from "@/lib/ebay/messages";
import { integrationDenied } from "@/lib/integrationAccess";
import { testConnection } from "@/lib/ebay/oauth";
import { errorText } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const denied = await integrationDenied();
  if (denied) return denied;
  try {
    const result = await testConnection();
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    if (error instanceof ReconnectError) {
      return NextResponse.json({ ok: false, message: RECONNECT_MESSAGE }, { status: 409 });
    }
    const message = errorText(error, "eBay connection test failed.");
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
