import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authRequired } from "@/lib/authRequired";
import { gateRequest, isCompanyEmail, type AppRole, type AppStatus } from "@/lib/authDomain";
import { isPublicPath } from "@/lib/publicPaths";

function asStatus(value: unknown): AppStatus | null {
  return value === "pending" || value === "approved" || value === "disabled" ? value : null;
}

function asRole(value: unknown): AppRole | null {
  return value === "admin" || value === "staff" || value === "read_only" ? value : null;
}

function redirectTo(request: NextRequest, path: string): NextResponse {
  const url = request.nextUrl.clone();
  const [pathname, search] = path.split("?");
  url.pathname = pathname || "/";
  url.search = search ? `?${search}` : "";
  if (path === "/login" && request.nextUrl.pathname !== "/login") {
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    if (next && next !== "/") url.searchParams.set("next", next);
  }
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();
  if (!authRequired()) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;

  const pendingCookies: { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] }[] = [];
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        pendingCookies.length = 0;
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
          pendingCookies.push(cookie);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of pendingCookies) response.cookies.set(name, value, options);
      },
    },
  });

  const { data: claimData } = await supabase.auth.getClaims();
  const claims = claimData?.claims;
  const email = typeof claims?.email === "string" ? claims.email : null;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  let status: AppStatus | null = null;
  let role: AppRole | null = null;

  if (email && userId && isCompanyEmail(email)) {
    const loaded = await supabase.from("app_users").select("status, role").eq("id", userId).maybeSingle();
    let profile = loaded.data;
    if (!profile) {
      await supabase.rpc("ensure_app_user");
      const refreshed = await supabase.from("app_users").select("status, role").eq("id", userId).maybeSingle();
      profile = refreshed.data;
    }
    status = asStatus(profile?.status);
    role = asRole(profile?.role);
  }

  const decision = gateRequest({
    pathname: request.nextUrl.pathname,
    email,
    domain: null,
    status,
    role,
  });

  if (decision.type === "redirect" && decision.path.startsWith("/login?error=domain") && email) {
    await supabase.auth.signOut();
  }

  if (decision.type === "allow") return response;
  const redirected = redirectTo(request, decision.path);
  for (const { name, value, options } of pendingCookies) redirected.cookies.set(name, value, options);
  return redirected;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
