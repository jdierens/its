import { NextResponse } from "next/server";
import { integrationDenied } from "@/lib/integrationAccess";
import { runSync } from "@/lib/qbo/sync";
import { parseSyncRequest } from "@/lib/qbo/syncOptions";
import { errorText } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = await integrationDenied();
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ entities: [], message: "Send entities, direction, and full." }, { status: 400 });
  }
  const parsed = parseSyncRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ entities: [], message: parsed.message }, { status: 400 });
  }
  try {
    const report = await runSync(parsed.value);
    return NextResponse.json(report);
  } catch (error) {
    const message = errorText(error, "QuickBooks sync failed.");
    const status = message.includes("already running") ? 409 : 400;
    return NextResponse.json({ entities: [], message }, { status });
  }
}
