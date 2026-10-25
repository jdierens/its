import { NextResponse } from "next/server";
import { applyLegacyLogSeed } from "@/lib/ebay/orders";
import { stockSettingsWritable } from "@/lib/stockAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 8_000_000;

export async function POST(request: Request) {
  if (!(await stockSettingsWritable())) {
    return NextResponse.json({ ok: false, message: "Only an admin can seed eBay orders." }, { status: 403 });
  }
  const csv = await request.text();
  if (csv.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, message: "That log map is too large." }, { status: 400 });
  }
  try {
    const result = await applyLegacyLogSeed(csv);
    return NextResponse.json({
      ok: true,
      linked: result.linked,
      skipped: result.skipped,
      conflicts: result.conflicts,
      missing: result.missing,
      message: result.message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The log map could not be applied.";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
