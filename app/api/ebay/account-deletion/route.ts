import { NextRequest, NextResponse } from "next/server";
import { challengeResponse } from "@/lib/ebay/challenge";
import { readDeletionToken } from "@/lib/ebay/config";
import { publicOrigin } from "@/lib/ebay/origin";
import { writeEbayLog } from "@/lib/ebay/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * eBay calls this URL with no signed-in user. Keep it on PUBLIC_PATHS so a
 * future Google sign-in check does not block the challenge or the notification.
 */
export async function GET(request: NextRequest) {
  const challengeCode = request.nextUrl.searchParams.get("challenge_code") ?? "";
  const verificationToken = readDeletionToken();
  if (!challengeCode || !verificationToken) {
    return NextResponse.json(
      { error: "Account deletion endpoint is not ready." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const endpoint = `${publicOrigin(request)}/api/ebay/account-deletion`;
  return NextResponse.json(
    { challengeResponse: challengeResponse(challengeCode, verificationToken, endpoint) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const notice = await readNotice(request);
  await writeEbayLog({
    entity: "notification",
    direction: "notification",
    status: "ok",
    message: notice.topic
      ? `Acknowledged eBay ${notice.topic} notification.`
      : "Acknowledged eBay account deletion notification.",
    detail: {
      notificationId: notice.notificationId,
      eventDate: notice.eventDate,
    },
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

async function readNotice(request: NextRequest): Promise<{
  topic: string | null;
  notificationId: string | null;
  eventDate: string | null;
}> {
  try {
    const body = (await request.json()) as {
      metadata?: { topic?: unknown };
      notification?: { notificationId?: unknown; eventDate?: unknown };
    };
    return {
      topic: textOrNull(body.metadata?.topic),
      notificationId: textOrNull(body.notification?.notificationId),
      eventDate: textOrNull(body.notification?.eventDate),
    };
  } catch {
    return { topic: null, notificationId: null, eventDate: null };
  }
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : null;
}
