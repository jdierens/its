import { NextResponse } from "next/server";
import { searchItemsToMatch } from "@/lib/ebay/listingsBrowser";
import { actorCan } from "@/lib/actorAccess";
import { errorText } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await actorCan("can_manage_integrations"))) {
    return NextResponse.json({ ok: false, message: "Only an admin can match an eBay listing." }, { status: 403 });
  }
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const items = await searchItemsToMatch(query);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    const message = errorText(error, "Item search failed.");
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
