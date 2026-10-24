import { NextRequest, NextResponse } from "next/server";
import { stripMoneyFields } from "@/lib/itemAttributeSearch";
import { ItemSearchDenied, itemSearchAccess, runAttributeSearch, searchFailure } from "@/lib/itemAttributeSearchServer";
import { parseAttributeSearchParams } from "@/lib/itemAttributeSearch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const access = await itemSearchAccess();
    const parsed = parseAttributeSearchParams(request.nextUrl.searchParams);
    const result = await runAttributeSearch(parsed);
    const items = result.items.map((item) =>
      stripMoneyFields(item as unknown as Record<string, unknown>, access.canViewFinancials),
    );
    return NextResponse.json(
      { ...result, items },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ItemSearchDenied) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: searchFailure(error) }, { status: 400 });
  }
}
