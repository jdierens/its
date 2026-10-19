import { NextResponse } from "next/server";
import { primaryStoragePath } from "@/lib/imageOrder";
import { ITEM_IMAGE_BUCKET } from "@/lib/images";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return new NextResponse("Item not found.", { status: 404 });
  }

  const supabase = await getSupabase();
  const listed = await supabase
    .from("item_images")
    .select("storage_path, sort_order")
    .eq("item_id", id);
  if (listed.error) return new NextResponse("Item not found.", { status: 404 });

  const path = primaryStoragePath((listed.data ?? []) as { storage_path: string; sort_order: number }[]);
  if (!path) return new NextResponse("This item has no photo.", { status: 404 });

  const signed = await supabase.storage.from(ITEM_IMAGE_BUCKET).createSignedUrl(path, 60 * 60);
  if (signed.error || !signed.data?.signedUrl) {
    return new NextResponse("This item has no photo.", { status: 404 });
  }
  return NextResponse.redirect(signed.data.signedUrl);
}
