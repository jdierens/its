import { NextResponse } from "next/server";
import { backfillLegacySoNumbers } from "@/lib/ebay/orders";
import { stockSettingsWritable } from "@/lib/stockAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (!(await stockSettingsWritable())) {
    return NextResponse.json({ ok: false, message: "Only an admin can assign legacy SO numbers." }, { status: 403 });
  }
  try {
    const result = await backfillLegacySoNumbers();
    return NextResponse.json({
      ok: true,
      assigned: result.assigned,
      conflicts: result.conflicts,
      message: result.message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Legacy SO numbers could not be assigned.";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
