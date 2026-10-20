import { NextResponse, type NextRequest } from "next/server";
import { authRequired } from "@/lib/authRequired";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!authRequired()) {
    return NextResponse.redirect(new URL("/items", request.url), { status: 303 });
  }
  const supabase = await getSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
