"use server";

import { errorText } from "@/lib/errors";
import { ITEM_IMAGE_BUCKET, imageExtension, imageFileError } from "@/lib/imageFiles";
import { appendSortStart, shiftedSortOrders, sortOrderAfterSource } from "@/lib/imageOrder";
import { getSupabase } from "@/lib/supabase";
import type { ItemImage } from "@/lib/types";

const SIGNED_URL_SECONDS = 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ImageRow = {
  id: string;
  item_id: string;
  storage_path: string;
  sort_order: number;
  source_image_id: string | null;
};

export type ImageUploadTicket = {
  id: string;
  path: string;
  signedUrl: string;
  sortOrder: number;
};

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

function assertIds(itemId: string, imageId: string): void {
  if (!UUID_PATTERN.test(itemId) || !UUID_PATTERN.test(imageId)) throw new Error("Unknown photo.");
}

function assertOwnedPath(itemId: string, imageId: string, path: string): void {
  assertIds(itemId, imageId);
  if (path.includes("..") || path.includes("\\") || !path.startsWith(`${itemId}/${imageId}.`)) {
    throw new Error("Unknown photo.");
  }
}

export async function signedImageUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return urls;

  const supabase = await getSupabase();
  const { data, error } = await supabase.storage.from(ITEM_IMAGE_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error) throw new Error(errorText(error));
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl);
  }
  return urls;
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

async function nextSortOrder(itemId: string): Promise<number> {
  const existing = await (await getSupabase()).from("item_images").select("sort_order").eq("item_id", itemId);
  if (existing.error) throw new Error(errorText(existing.error));
  return appendSortStart((existing.data ?? []).map((row) => Number(row.sort_order)));
}

async function reserveUpload(itemId: string, file: { name: string; type: string; size: number }, sortOrder: number): Promise<ImageUploadTicket> {
  const problem = imageFileError(file);
  if (problem) throw new Error(problem);
  const id = crypto.randomUUID();
  const path = `${itemId}/${id}.${imageExtension(file)}`;
  assertOwnedPath(itemId, id, path);
  const supabase = await getSupabase();
  const signed = await supabase.storage.from(ITEM_IMAGE_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(signed.error ? errorText(signed.error) : "Could not prepare the photo upload.");
  }
  return { id, path, signedUrl: signed.data.signedUrl, sortOrder };
}

export async function reserveItemImageUpload(
  itemId: string,
  file: { name: string; type: string; size: number },
): Promise<ImageUploadTicket> {
  if (!UUID_PATTERN.test(itemId)) throw new Error("Unknown item.");
  return reserveUpload(itemId, file, await nextSortOrder(itemId));
}

async function objectIsStored(path: string): Promise<boolean> {
  const supabase = await getSupabase();
  const signed = await supabase.storage.from(ITEM_IMAGE_BUCKET).createSignedUrl(path, 60);
  if (signed.error || !signed.data?.signedUrl) return false;
  const response = await fetch(signed.data.signedUrl, { headers: { Range: "bytes=0-0" } });
  await response.body?.cancel();
  return response.ok;
}

export async function commitItemImageUpload(input: {
  itemId: string;
  id: string;
  path: string;
  sortOrder: number;
}): Promise<void> {
  assertOwnedPath(input.itemId, input.id, input.path);
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) throw new Error("Could not save the photo.");
  if (!(await objectIsStored(input.path))) throw new Error("The photo did not finish uploading.");
  const { error } = await (await getSupabase()).from("item_images").insert({
    id: input.id,
    item_id: input.itemId,
    storage_path: input.path,
    sort_order: input.sortOrder,
  });
  if (error) throw new Error(errorText(error));
}

export async function discardItemImage(path: string): Promise<void> {
  if (!path || path.includes("..") || path.startsWith("/")) return;
  await (await getSupabase()).storage.from(ITEM_IMAGE_BUCKET).remove([path]);
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
  assertOwnedPath(image.itemId, image.id, image.storagePath);
  const supabase = await getSupabase();
  const removed = await supabase.storage.from(ITEM_IMAGE_BUCKET).remove([image.storagePath]);
  if (removed.error) throw new Error(errorText(removed.error));
  const { error } = await supabase.from("item_images").delete().eq("id", image.id).eq("item_id", image.itemId);
  if (error) throw new Error(errorText(error));
}

export async function reserveEditedImageUpload(input: {
  itemId: string;
  sourceImageId: string;
  type: string;
  size: number;
}): Promise<ImageUploadTicket> {
  assertIds(input.itemId, input.sourceImageId);
  const type = input.type === "image/png" ? "image/png" : "image/jpeg";
  const name = type === "image/png" ? "edit.png" : "edit.jpg";
  return reserveUpload(input.itemId, { name, type, size: input.size }, 0);
}

export async function commitEditedImage(input: {
  itemId: string;
  sourceImageId: string;
  id: string;
  path: string;
}): Promise<void> {
  assertOwnedPath(input.itemId, input.id, input.path);
  assertIds(input.itemId, input.sourceImageId);
  if (!(await objectIsStored(input.path))) throw new Error("The photo did not finish uploading.");

  const supabase = await getSupabase();
  const existing = await supabase.from("item_images").select("id, sort_order").eq("item_id", input.itemId);
  if (existing.error) throw new Error(errorText(existing.error));
  const orders = (existing.data ?? []).map((row) => ({
    id: String(row.id),
    sortOrder: Number(row.sort_order),
  }));
  const insertAt = sortOrderAfterSource(orders, input.sourceImageId);
  const shifts = shiftedSortOrders(orders, insertAt);

  try {
    for (const shift of shifts) {
      const updated = await supabase.from("item_images").update({ sort_order: shift.sortOrder }).eq("id", shift.id);
      if (updated.error) throw new Error(errorText(updated.error));
    }
    const inserted = await supabase.from("item_images").insert({
      id: input.id,
      item_id: input.itemId,
      storage_path: input.path,
      sort_order: insertAt,
      source_image_id: input.sourceImageId,
    });
    if (inserted.error) throw new Error(errorText(inserted.error));
  } catch (error) {
    await supabase.storage.from(ITEM_IMAGE_BUCKET).remove([input.path]);
    for (const shift of [...shifts].reverse()) {
      await supabase.from("item_images").update({ sort_order: shift.sortOrder - 1 }).eq("id", shift.id);
    }
    throw error;
  }
}

export async function signedItemImageUrl(storagePath: string): Promise<string> {
  const supabase = await getSupabase();
  const row = await supabase.from("item_images").select("id").eq("storage_path", storagePath).maybeSingle();
  if (row.error) throw new Error(errorText(row.error));
  if (!row.data) throw new Error("Could not download the photo.");
  const signed = await supabase.storage.from(ITEM_IMAGE_BUCKET).createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) throw new Error("Could not download the photo.");
  return signed.data.signedUrl;
}
