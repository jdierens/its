import { NextResponse } from "next/server";
import { actorCan } from "@/lib/actorAccess";

/** Connect, disconnect, and sync stay on can_manage_integrations. */
export async function integrationDenied(): Promise<NextResponse | null> {
  if (await actorCan("can_manage_integrations")) return null;
  return NextResponse.json({ ok: false, message: "You cannot change integrations." }, { status: 403 });
}
