import { NextResponse, type NextRequest } from "next/server";
import { authRequired } from "@/lib/authRequired";
import { hostedDomain, isCompanyEmail, safeNextPath } from "@/lib/authDomain";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function loginRedirect(request: NextRequest, error: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  if (!authRequired()) {
    const url = request.nextUrl.clone();
    url.pathname = "/items";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  if (!code) return loginRedirect(request, "missing");

  const supabase = await getSupabase();
  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  if (exchanged.error) return loginRedirect(request, "denied");

  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  const email = user?.email ?? null;
  const identity = user?.identities?.find((item) => item.provider === "google") ?? user?.identities?.[0];
  const domain = hostedDomain(identity);
  if (error || !user || !isCompanyEmail(email) || (domain && domain !== "deepdiscountservers.com")) {
    await supabase.auth.signOut();
    return loginRedirect(request, "domain");
  }

  const identityData = identity?.identity_data;
  const record = identityData && typeof identityData === "object" ? (identityData as { name?: unknown; full_name?: unknown }) : null;
  const name = typeof record?.full_name === "string" ? record.full_name : typeof record?.name === "string" ? record.name : null;
  const ensured = await supabase.rpc("ensure_app_user", { p_name: name });
  if (ensured.error) {
    await supabase.auth.signOut();
    return loginRedirect(request, "profile");
  }

  const status = ensured.data && typeof ensured.data === "object" && "status" in ensured.data
    ? String((ensured.data as { status?: string }).status ?? "")
    : "";
  const url = request.nextUrl.clone();
  url.search = "";
  if (status === "approved") {
    const target = new URL(next, request.url);
    url.pathname = target.pathname;
    url.search = target.search;
  } else {
    url.pathname = "/waiting";
  }
  return NextResponse.redirect(url);
}
