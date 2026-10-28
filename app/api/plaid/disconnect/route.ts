import { NextResponse } from "next/server";
import { plaidActor } from "@/lib/plaid/actor";
import { disconnectItem } from "@/lib/plaid/feed";
import { isUuid } from "@/lib/plaid/ids";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await plaidActor();
  if (!actor.ok) return NextResponse.json({ message: actor.message }, { status: actor.status });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Choose a bank connection to disconnect." }, { status: 400 });
  }
  const id = body && typeof body === "object" ? (body as { id?: unknown }).id : null;
  if (!isUuid(id)) return NextResponse.json({ message: "That bank connection was not found." }, { status: 400 });
  try {
    const message = await disconnectItem(id);
    return NextResponse.json({ ok: true, message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not disconnect the bank.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
