import { NextResponse } from "next/server";
import { integrationDenied } from "@/lib/integrationAccess";
import { disconnectEbay } from "@/lib/ebay/oauth";
import { errorText } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const denied = await integrationDenied();
  if (denied) return denied;
  try {
    await disconnectEbay();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = errorText(error, "eBay could not be disconnected.");
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
