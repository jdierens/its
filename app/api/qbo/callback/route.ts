import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { QBO_STATE_COOKIE } from "@/lib/qbo/config";
import { exchangeCode } from "@/lib/qbo/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const oauthError = params.get("error");
  if (oauthError) {
    return fail(request, params.get("error_description") || oauthError);
  }

  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";
  const realmId = params.get("realmId") ?? "";
  const cookie = request.cookies.get(QBO_STATE_COOKIE)?.value ?? "";
  if (!code || !realmId || !safeEqual(state, cookie)) {
    return fail(request, "QuickBooks sign-in could not be verified. Try connecting again.");
  }

  try {
    await exchangeCode(code, realmId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "QuickBooks connection failed.";
    return fail(request, message);
  }

  const response = NextResponse.redirect(integrationsUrl(request, { connected: "1" }));
  response.cookies.delete(QBO_STATE_COOKIE);
  return response;
}

function fail(request: NextRequest, message: string) {
  const response = NextResponse.redirect(integrationsUrl(request, { error: message.slice(0, 300) }));
  response.cookies.delete(QBO_STATE_COOKIE);
  return response;
}

function integrationsUrl(request: NextRequest, query: Record<string, string>): URL {
  const url = new URL("/admin/integrations", request.url);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
