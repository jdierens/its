import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { EBAY_STATE_COOKIE } from "@/lib/ebay/endpoints";
import { writeEbayLog } from "@/lib/ebay/log";
import { CSRF_MESSAGE } from "@/lib/ebay/messages";
import { exchangeCode } from "@/lib/ebay/oauth";

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
  const cookie = request.cookies.get(EBAY_STATE_COOKIE)?.value ?? "";
  if (!safeEqual(state, cookie)) {
    await writeEbayLog({
      entity: "connection",
      direction: "oauth",
      status: "error",
      message: CSRF_MESSAGE,
    });
    return fail(request, CSRF_MESSAGE);
  }
  if (!code) {
    return fail(request, "eBay did not return an authorization code. Try Connect again.");
  }

  try {
    await exchangeCode(code);
  } catch (error) {
    const message = error instanceof Error ? error.message : "eBay connection failed.";
    return fail(request, message);
  }

  const response = NextResponse.redirect(integrationsUrl(request, { ebay_connected: "1" }));
  response.cookies.delete(EBAY_STATE_COOKIE);
  return response;
}

function fail(request: NextRequest, message: string) {
  const response = NextResponse.redirect(integrationsUrl(request, { ebay_error: message.slice(0, 300) }));
  response.cookies.delete(EBAY_STATE_COOKIE);
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
