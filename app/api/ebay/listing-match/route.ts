import { NextResponse } from "next/server";
import { matchEbayListing } from "@/lib/ebay/listingsBrowser";
import { actorCan } from "@/lib/actorAccess";
import { errorText } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await actorCan("can_manage_integrations"))) {
    return NextResponse.json({ ok: false, message: "Only an admin can match an eBay listing." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { listingId?: unknown; itemId?: unknown } | null;
  const listingId = typeof body?.listingId === "string" ? body.listingId : "";
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  try {
    const result = await matchEbayListing(listingId, itemId);
    if (!result.ok) return NextResponse.json({ ok: false, message: result.message }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = errorText(error, "That listing could not be matched.");
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
