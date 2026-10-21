import { NextResponse, type NextRequest } from "next/server";
import { ExportDenied, requireExportActor } from "@/lib/export/access";
import { saveGoogleRefreshToken } from "@/lib/google/grants";
import { exchangeGoogleCode, readGoogleOAuth } from "@/lib/google/sheets";
import { safeItemsReturnPath } from "@/lib/google/returnPath";
import { publicOrigin } from "@/lib/ebay/origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "its_sheets_state";
const NEXT_COOKIE = "its_sheets_next";

export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const back = new URL(safeItemsReturnPath(request.cookies.get(NEXT_COOKIE)?.value), origin);
  const fail = (code: string) => {
    back.searchParams.set("sheets", code);
    const response = NextResponse.redirect(back);
    response.cookies.delete(STATE_COOKIE);
    response.cookies.delete(NEXT_COOKIE);
    return response;
  };

  const config = readGoogleOAuth(process.env);
  if (!config) return fail("unconfigured");

  const state = request.nextUrl.searchParams.get("state");
  const saved = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || !saved || state !== saved) return fail("state");

  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) return fail("denied");
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return fail("missing");

  try {
    const actor = await requireExportActor();
    const tokens = await exchangeGoogleCode({
      config,
      code,
      redirectUri: `${origin}/api/items/export/google/callback`,
    });
    await saveGoogleRefreshToken(actor.id, tokens.refreshToken);
  } catch (error) {
    if (error instanceof ExportDenied) {
      const login = new URL("/login", origin);
      login.searchParams.set("next", "/items");
      return NextResponse.redirect(login);
    }
    return fail("error");
  }

  back.searchParams.set("sheets", "connected");
  const response = NextResponse.redirect(back);
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(NEXT_COOKIE);
  return response;
}
