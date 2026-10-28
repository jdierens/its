import { NextResponse } from "next/server";
import { ReconnectError } from "@/lib/ebay/auth";
import { RECONNECT_MESSAGE } from "@/lib/ebay/messages";
import { orderPullMessage, pullEbayOrders, SeedRequiredError } from "@/lib/ebay/orders";
import { stockSettingsWritable } from "@/lib/stockAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Matches the other long eBay and QuickBooks routes. Incremental pulls no longer rewrite every draft. */
export const maxDuration = 60;

export async function POST() {
  if (!(await stockSettingsWritable())) {
    return NextResponse.json({ ok: false, message: "Only an admin can pull eBay orders." }, { status: 403 });
  }
  try {
    const result = await pullEbayOrders();
    return NextResponse.json({
      ok: true,
      ...result,
      message: orderPullMessage(result),
    });
  } catch (error) {
    if (error instanceof ReconnectError) {
      return NextResponse.json({ ok: false, message: RECONNECT_MESSAGE }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "eBay order pull failed.";
    const status = error instanceof SeedRequiredError ? 409 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
