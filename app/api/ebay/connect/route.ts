import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { authorizeUrl, readEbayConfig } from "@/lib/ebay/config";
import { EBAY_STATE_COOKIE } from "@/lib/ebay/endpoints";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = readEbayConfig();
  if (!config) {
    return NextResponse.redirect(
      integrationsUrl(request, {
        ebay_error: "Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME, and EBAY_ENVIRONMENT.",
      }),
    );
  }

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(authorizeUrl(config, state));
  // httpOnly, SameSite=Lax, and a 10 minute max-age. Secure is set in production,
  // where the app is served over HTTPS. Local http development omits Secure so
  // the browser will store the cookie.
  response.cookies.set(EBAY_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}

function integrationsUrl(request: NextRequest, query: Record<string, string>): URL {
  const url = new URL("/admin/integrations/ebay", request.url);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}
