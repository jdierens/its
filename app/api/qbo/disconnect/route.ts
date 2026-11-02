import { NextResponse } from "next/server";
import { integrationDenied } from "@/lib/integrationAccess";
import { disconnectQuickBooks } from "@/lib/qbo/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const denied = await integrationDenied();
  if (denied) return denied;
  try {
    await disconnectQuickBooks();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "QuickBooks could not be disconnected.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
