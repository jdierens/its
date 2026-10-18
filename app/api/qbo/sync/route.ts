import { NextResponse } from "next/server";
import { runSync } from "@/lib/qbo/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const report = await runSync();
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "QuickBooks sync failed.";
    const status = message.includes("already running") ? 409 : 400;
    return NextResponse.json({ pushed: 0, pulled: 0, conflicts: 0, errors: 1, message }, { status });
  }
}
