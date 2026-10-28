import { NextResponse } from "next/server";
import { plaidActor } from "@/lib/plaid/actor";
import { exchangePublicToken } from "@/lib/plaid/feed";
import { isPublicToken } from "@/lib/plaid/ids";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const actor = await plaidActor();
  if (!actor.ok) return NextResponse.json({ message: actor.message }, { status: actor.status });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Send the public token from Plaid Link." }, { status: 400 });
  }
  const publicToken = body && typeof body === "object" ? (body as { publicToken?: unknown }).publicToken : null;
  if (!isPublicToken(publicToken)) {
    return NextResponse.json({ message: "Plaid did not return a usable public token." }, { status: 400 });
  }
  try {
    const saved = await exchangePublicToken(publicToken, actor.email);
    return NextResponse.json({ ok: true, id: saved.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not connect the bank.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
