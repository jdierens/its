import { NextResponse } from "next/server";
import { plaidActor } from "@/lib/plaid/actor";
import { createLinkToken } from "@/lib/plaid/feed";
import { isUuid } from "@/lib/plaid/ids";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await plaidActor();
  if (!actor.ok) return NextResponse.json({ message: actor.message }, { status: actor.status });
  let itemId: string | null = null;
  try {
    const body = (await request.json()) as { itemId?: unknown };
    if (body.itemId != null) {
      if (!isUuid(body.itemId)) return NextResponse.json({ message: "That bank connection was not found." }, { status: 400 });
      itemId = body.itemId;
    }
  } catch {
    itemId = null;
  }
  try {
    const token = await createLinkToken({ itemId });
    return NextResponse.json(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Plaid Link.";
    const status = message.startsWith("Add Plaid credentials") ? 503 : 400;
    return NextResponse.json({ message }, { status });
  }
}
