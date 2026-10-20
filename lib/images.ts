import { errorText } from "@/lib/errors";
import {
  appendSortStart,
  shiftedSortOrders,
  sortOrderAfterSource,
} from "@/lib/imageOrder";
import { getSupabase } from "@/lib/supabase";
import type { ItemImage } from "@/lib/types";

export const ITEM_IMAGE_BUCKET = "item-images";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const SIGNED_URL_SECONDS = 60 * 60;

type ImageRow = {
  id: string;
  item_id: string;
  storage_path: string;
  sort_order: number;
  source_image_id: string | null;
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
  if (file.size > MAX_IMAGE_BYTES) {
    return `${file.name} is larger than 10 MB.`;
  }
  return null;
}

export async function signedImageUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return urls;

  const supabase = await getSupabase();
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
    sortOrder: row.sort_order,
    sourceImageId: row.source_image_id,
    url,
  };
}

export async function fetchItemImages(itemId: string): Promise<ItemImage[]> {
  const { data, error } = await (await getSupabase())
    .from("item_images")
    .select("id, item_id, storage_path, sort_order, source_image_id")
    .eq("item_id", itemId)
    .order("sort_order")
    .order("created_at");

  if (error) throw new Error(errorText(error));

  const rows = (data ?? []) as ImageRow[];
  const urls = await signedImageUrls(rows.map((row) => row.storage_path));
  return rows.map((row) => toItemImage(row, urls.get(row.storage_path) ?? null));
}

export async function uploadItemImages(itemId: string, files: File[]): Promise<void> {
  if (files.length === 0) return;

  const supabase = await getSupabase();
  const existing = await supabase
    .from("item_images")
    .select("sort_order")
    .eq("item_id", itemId);
  if (existing.error) throw new Error(errorText(existing.error));
  let sortOrder = appendSortStart((existing.data ?? []).map((row) => Number(row.sort_order)));
  const uploadedPaths: string[] = [];

  try {
    for (const file of files) {
      const id = crypto.randomUUID();
      const path = `${itemId}/${id}.${extensionFor(file)}`;
      const { error: uploadError } = await supabase.storage.from(ITEM_IMAGE_BUCKET).upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw new Error(errorText(uploadError));
      uploadedPaths.push(path);

      const { error: insertError } = await supabase.from("item_images").insert({
        id,
        item_id: itemId,
        storage_path: path,
        sort_order: sortOrder,
      });
      if (insertError) throw new Error(errorText(insertError));
      sortOrder += 1;
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(ITEM_IMAGE_BUCKET).remove(uploadedPaths);
      await supabase.from("item_images").delete().in("storage_path", uploadedPaths);
    }
    throw error;
  }
}

export async function reorderItemImages(itemId: string, orderedIds: string[]): Promise<void> {
  const supabase = await getSupabase();
  const results = await Promise.all(
    orderedIds.map((id, sortOrder) =>
      supabase.from("item_images").update({ sort_order: sortOrder }).eq("id", id).eq("item_id", itemId),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(errorText(failed.error));
}

export async function deleteItemImage(image: ItemImage): Promise<void> {
  const supabase = await getSupabase();
  const removed = await supabase.storage.from(ITEM_IMAGE_BUCKET).remove([image.storagePath]);
  if (removed.error) throw new Error(errorText(removed.error));
  const { error } = await supabase.from("item_images").delete().eq("id", image.id);
  if (error) throw new Error(errorText(error));
}

export async function saveEditedImage(input: {
  itemId: string;
  sourceImageId: string;
  blob: Blob;
}): Promise<string> {
  const supabase = await getSupabase();
  const id = crypto.randomUUID();
  const extension = input.blob.type === "image/png" ? "png" : "jpg";
  const path = `${input.itemId}/${id}.${extension}`;
  const contentType = extension === "png" ? "image/png" : "image/jpeg";

  const existing = await supabase.from("item_images").select("id, sort_order").eq("item_id", input.itemId);
  if (existing.error) throw new Error(errorText(existing.error));
  const orders = (existing.data ?? []).map((row) => ({
    id: String(row.id),
    sortOrder: Number(row.sort_order),
  }));
  const insertAt = sortOrderAfterSource(orders, input.sourceImageId);
  const shifts = shiftedSortOrders(orders, insertAt);

  const uploaded = await supabase.storage.from(ITEM_IMAGE_BUCKET).upload(path, input.blob, {
    contentType,
    upsert: false,
  });
  if (uploaded.error) throw new Error(errorText(uploaded.error));

  try {
    for (const shift of shifts) {
      const updated = await supabase.from("item_images").update({ sort_order: shift.sortOrder }).eq("id", shift.id);
      if (updated.error) throw new Error(errorText(updated.error));
    }
    const inserted = await supabase.from("item_images").insert({
      id,
      item_id: input.itemId,
      storage_path: path,
      sort_order: insertAt,
      source_image_id: input.sourceImageId,
    });
    if (inserted.error) throw new Error(errorText(inserted.error));
  } catch (error) {
    await supabase.storage.from(ITEM_IMAGE_BUCKET).remove([path]);
    for (const shift of [...shifts].reverse()) {
      await supabase.from("item_images").update({ sort_order: shift.sortOrder - 1 }).eq("id", shift.id);
    }
    throw error;
  }
  return id;
}

export async function downloadItemImage(storagePath: string): Promise<Blob> {
  const downloaded = await (await getSupabase()).storage.from(ITEM_IMAGE_BUCKET).download(storagePath);
  if (downloaded.error || !downloaded.data) {
    throw new Error(downloaded.error ? errorText(downloaded.error) : "Could not download the photo.");
  }
  return downloaded.data;
}
