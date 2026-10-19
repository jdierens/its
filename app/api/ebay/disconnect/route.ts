import { NextResponse } from "next/server";
import { disconnectEbay } from "@/lib/ebay/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    await disconnectEbay();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "eBay could not be disconnected.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
