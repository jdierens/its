import type { NextRequest } from "next/server";

/** Origin the browser or eBay used, including Vercel's forwarded host. */
export function publicOrigin(request: NextRequest): string {
  const forwardedHost = firstHeader(request.headers.get("x-forwarded-host"));
  const host = forwardedHost || firstHeader(request.headers.get("host")) || request.nextUrl.host;
  const forwardedProto = firstHeader(request.headers.get("x-forwarded-proto"));
  const proto = forwardedProto || request.nextUrl.protocol.replace(":", "") || "http";
  return `${proto}://${host}`;
}

function firstHeader(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim() ?? "";
  return first.length > 0 ? first : null;
}
