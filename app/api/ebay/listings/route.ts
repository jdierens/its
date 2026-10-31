import { NextResponse } from "next/server";
import { ReconnectError } from "@/lib/ebay/auth";
import { pullActiveListings } from "@/lib/ebay/listings";
import { RECONNECT_MESSAGE } from "@/lib/ebay/messages";
import { stockSettingsWritable } from "@/lib/stockAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  if (!(await stockSettingsWritable())) {
    return NextResponse.json({ ok: false, message: "Only an admin can refresh eBay listings." }, { status: 403 });
  }
  try {
    const result = await pullActiveListings();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ReconnectError) {
      return NextResponse.json({ ok: false, message: RECONNECT_MESSAGE }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "eBay listings pull failed.";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
