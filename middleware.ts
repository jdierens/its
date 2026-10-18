import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/publicPaths";

/**
 * Sign-in is not enforced yet. When Google sign-in is added, put the session
 * check in the branch below and do not require a session for isPublicPath().
 * /privacy and /terms must stay publicly reachable without an account.
 */
export function middleware(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
