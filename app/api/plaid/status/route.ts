import { NextResponse } from "next/server";
import { plaidActor } from "@/lib/plaid/actor";
import { plaidStatus } from "@/lib/plaid/feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const actor = await plaidActor();
  if (!actor.ok && actor.status === 401) {
    return NextResponse.json({ message: actor.message }, { status: 401, headers: noStore });
  }
  const status = await plaidStatus(actor.ok ? null : actor.message);
  return NextResponse.json(status, { headers: noStore });
}
