import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { authorizationRedirect } from "@/lib/qbo/oauth";
import { QBO_STATE_COOKIE, readQboConfig } from "@/lib/qbo/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = readQboConfig();
  if (!config) {
    return NextResponse.redirect(
      integrationsUrl(request, {
        error: "Set QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, and QBO_ENVIRONMENT.",
      }),
    );
  }

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(await authorizationRedirect(config, state));
  // httpOnly, SameSite=Lax, and a 10 minute max-age. Secure is set in production,
  // where the app is served over HTTPS. Local http development omits Secure so
  // the browser will store the cookie.
  response.cookies.set(QBO_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}

function integrationsUrl(request: NextRequest, query: Record<string, string>): URL {
  const url = new URL("/admin/integrations", request.url);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}
