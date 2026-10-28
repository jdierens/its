import { NextResponse } from "next/server";
import { plaidActor } from "@/lib/plaid/actor";
import { syncAll, syncItem } from "@/lib/plaid/feed";
import { isUuid } from "@/lib/plaid/ids";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const actor = await plaidActor();
  if (!actor.ok) return NextResponse.json({ message: actor.message }, { status: actor.status });
  let itemId: string | null = null;
  try {
    const body = (await request.json()) as { id?: unknown };
    if (body.id != null) {
      if (!isUuid(body.id)) return NextResponse.json({ message: "That bank connection was not found." }, { status: 400 });
      itemId = body.id;
    }
  } catch {
    itemId = null;
  }
  try {
    const reports = itemId ? [await syncItem(itemId)] : await syncAll();
    return NextResponse.json({ ok: true, reports });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bank sync failed.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
