import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { QBO_STATE_COOKIE, authorizeUrl, readQboConfig } from "@/lib/qbo/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const config = readQboConfig();
  if (!config) {
    return NextResponse.redirect(
      integrationsUrl(request, {
        error: "Set QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, and QBO_ENVIRONMENT.",
      }),
    );
  }

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(authorizeUrl(config, state));
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
