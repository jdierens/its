import { NextResponse, type NextRequest } from "next/server";
import { ExportDenied, requireExportActor } from "@/lib/export/access";
import { googleConsentUrl, readGoogleOAuth } from "@/lib/google/sheets";
import { safeItemsReturnPath } from "@/lib/google/returnPath";
import { publicOrigin } from "@/lib/ebay/origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "its_sheets_state";
const NEXT_COOKIE = "its_sheets_next";

export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const back = new URL(safeItemsReturnPath(request.nextUrl.searchParams.get("next")), origin);
  try {
    const actor = await requireExportActor();
    const config = readGoogleOAuth(process.env);
    if (!config) {
      back.searchParams.set("sheets", "unconfigured");
      return NextResponse.redirect(back);
    }
    const state = crypto.randomUUID();
    const url = googleConsentUrl({
      config,
      redirectUri: `${origin}/api/items/export/google/callback`,
      state,
      loginHint: actor.email,
    });
    const response = NextResponse.redirect(url);
    const cookie = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: origin.startsWith("https://"),
      path: "/",
      maxAge: 600,
    };
    response.cookies.set(STATE_COOKIE, state, cookie);
    response.cookies.set(NEXT_COOKIE, safeItemsReturnPath(request.nextUrl.searchParams.get("next")), cookie);
    return response;
  } catch (error) {
    if (error instanceof ExportDenied) {
      const login = new URL("/login", origin);
      login.searchParams.set("next", "/items");
      return NextResponse.redirect(login);
    }
    back.searchParams.set("sheets", "error");
    return NextResponse.redirect(back);
  }
}
