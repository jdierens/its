import { errorText } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import type { ItemImage } from "@/lib/types";

export const ITEM_IMAGE_BUCKET = "item-images";

const SIGNED_URL_SECONDS = 60 * 60;

type ImageRow = {
  id: string;
  item_id: string;
  storage_path: string;
  is_primary: boolean;
  sort_order: number;
};

export type PendingUpload = {
  file: File;
  isPrimary: boolean;
};

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}

export function imageFileError(file: File): string | null {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowed.includes(file.type)) {
    return `${file.name} must be a JPEG, PNG, WebP, or GIF.`;
  }
  if (file.size > 5 * 1024 * 1024) {
    return `${file.name} is larger than 5 MB.`;
  }
  return null;
}

export async function signedImageUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return urls;

  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(ITEM_IMAGE_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_SECONDS);

  if (!error && data) {
    for (const row of data) {
      if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl);
    }
  }

  const missing = unique.filter((path) => !urls.has(path));
  await Promise.all(
    missing.map(async (path) => {
      const downloaded = await supabase.storage.from(ITEM_IMAGE_BUCKET).download(path);
      if (!downloaded.error && downloaded.data) {
        urls.set(path, URL.createObjectURL(downloaded.data));
      }
    }),
  );

  return urls;
}

function toItemImage(row: ImageRow, url: string | null): ItemImage {
  return {
    id: row.id,
    itemId: row.item_id,
    storagePath: row.storage_path,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
    url,
  };
}

export async function fetchItemImages(itemId: string): Promise<ItemImage[]> {
  const { data, error } = await getSupabase()
    .from("item_images")
    .select("id, item_id, storage_path, is_primary, sort_order")
    .eq("item_id", itemId)
    .order("sort_order")
    .order("created_at");

  if (error) throw new Error(errorText(error));

  const rows = (data ?? []) as ImageRow[];
  const urls = await signedImageUrls(rows.map((row) => row.storage_path));
  return rows.map((row) => toItemImage(row, urls.get(row.storage_path) ?? null));
}

export async function uploadItemImages(itemId: string, uploads: PendingUpload[]): Promise<void> {
  if (uploads.length === 0) return;

  const supabase = getSupabase();
  const ordered = [...uploads].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const uploadedPaths: string[] = [];

  try {
    for (const [index, upload] of ordered.entries()) {
      const id = crypto.randomUUID();
      const path = `${itemId}/${id}.${extensionFor(upload.file)}`;
      const { error: uploadError } = await supabase.storage
        .from(ITEM_IMAGE_BUCKET)
        .upload(path, upload.file, {
          contentType: upload.file.type,
          upsert: false,
        });
      if (uploadError) throw new Error(errorText(uploadError));
      uploadedPaths.push(path);

      const { error: insertError } = await supabase.from("item_images").insert({
        id,
        item_id: itemId,
        storage_path: path,
        is_primary: upload.isPrimary,
        sort_order: index,
      });
      if (insertError) throw new Error(errorText(insertError));
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(ITEM_IMAGE_BUCKET).remove(uploadedPaths);
      await supabase.from("item_images").delete().in("storage_path", uploadedPaths);
    }
    throw error;
  }
}

export async function deleteItemImage(image: ItemImage): Promise<void> {
  const supabase = getSupabase();
  const removed = await supabase.storage.from(ITEM_IMAGE_BUCKET).remove([image.storagePath]);
  if (removed.error) throw new Error(errorText(removed.error));
  const { error } = await supabase.from("item_images").delete().eq("id", image.id);
  if (error) throw new Error(errorText(error));
}

export async function setPrimaryImage(image: ItemImage): Promise<void> {
  const { error } = await getSupabase()
    .from("item_images")
    .update({ is_primary: true })
    .eq("id", image.id);
  if (error) throw new Error(errorText(error));
}
