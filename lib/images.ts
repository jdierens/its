"use server";

import { withDeadline } from "@/lib/deadline";
import { errorText } from "@/lib/errors";
import { ITEM_IMAGE_BUCKET, imageExtension, imageFileError } from "@/lib/imageFiles";
import {
  imageProcessingColumnMissing,
  imageProcessingStatus,
  isProcessedImagePath,
  processedImagePath,
  processingClaimIsStale,
  storagePathsForImage,
  type ImageProcessClaim,
} from "@/lib/imagePipeline";
import { appendSortStart, shiftedSortOrders, sortOrderAfterSource } from "@/lib/imageOrder";
import { getSupabase } from "@/lib/supabase";
import type { ItemImage } from "@/lib/types";

const SIGNED_URL_SECONDS = 60 * 60;
const STORAGE_CHECK_MS = 8_000;
const STORAGE_MISSING = "The photo did not finish uploading.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IMAGE_COLUMNS =
  "id, item_id, storage_path, sort_order, source_image_id, processing_status, processing_started_at, processed_at, processing_error, original_storage_path";

type ImageRow = {
  id: string;
  item_id: string;
  storage_path: string;
  sort_order: number;
  source_image_id: string | null;
  processing_status: string | null;
  processing_started_at: string | null;
  processed_at: string | null;
  processing_error: string | null;
  original_storage_path: string | null;
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
    processingStatus: imageProcessingStatus(row.processing_status),
    processingStartedAt: row.processing_started_at ?? null,
    processedAt: row.processed_at ?? null,
    processingError: row.processing_error ?? null,
    originalStoragePath: row.original_storage_path ?? null,
  };
}

function assertStartedAt(value: string): void {
  if (!/^[0-9TZ.: +-]{10,40}$/.test(value)) throw new Error("Could not update the photo.");
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

const LEGACY_IMAGE_COLUMNS = "id, item_id, storage_path, sort_order, source_image_id";

export async function fetchItemImages(itemId: string): Promise<ItemImage[]> {
  const supabase = await getSupabase();
  const selected = await supabase
    .from("item_images")
    .select(IMAGE_COLUMNS)
    .eq("item_id", itemId)
    .order("sort_order")
    .order("created_at");
  let data = selected.data as ImageRow[] | null;
  if (selected.error) {
    if (!imageProcessingColumnMissing(selected.error)) throw new Error(errorText(selected.error));
    const legacy = await supabase
      .from("item_images")
      .select(LEGACY_IMAGE_COLUMNS)
      .eq("item_id", itemId)
      .order("sort_order")
      .order("created_at");
    if (legacy.error) throw new Error(errorText(legacy.error));
    data = (legacy.data ?? []).map((row) => ({
      ...row,
      processing_status: null,
      processing_started_at: null,
      processed_at: null,
      processing_error: null,
      original_storage_path: null,
    }));
  }

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
  // HEAD metadata only. Downloading the object (and then cancelling the body)
  // never settled after the lockdown, so the item_images row was never inserted.
  const found = await withDeadline(
    supabase.storage.from(ITEM_IMAGE_BUCKET).exists(path),
    STORAGE_CHECK_MS,
    STORAGE_MISSING,
  );
  if (found.data) return true;
  if (!found.error) return false;
  const status = "status" in found.error ? Number(found.error.status) : undefined;
  if (status === 400 || status === 404) return false;
  throw new Error(errorText(found.error));
}

export async function commitItemImageUpload(input: {
  itemId: string;
  id: string;
  path: string;
  sortOrder: number;
}): Promise<void> {
  assertOwnedPath(input.itemId, input.id, input.path);
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) throw new Error("Could not save the photo.");
  if (!(await objectIsStored(input.path))) throw new Error(STORAGE_MISSING);
  const { error } = await (await getSupabase()).from("item_images").insert({
    id: input.id,
    item_id: input.itemId,
    storage_path: input.path,
    sort_order: input.sortOrder,
    original_storage_path: input.path,
    processing_status: "pending",
  });
  if (error) {
    if (imageProcessingColumnMissing(error)) {
      throw new Error("Apply the item image processing migration, then upload the photo again.");
    }
    throw new Error(errorText(error));
  }
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
  const paths = storagePathsForImage({
    storagePath: image.storagePath,
    originalStoragePath: image.originalStoragePath,
  });
  for (const path of paths) assertOwnedPath(image.itemId, image.id, path);
  const supabase = await getSupabase();
  const removed = await supabase.storage.from(ITEM_IMAGE_BUCKET).remove(paths);
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
  if (!(await objectIsStored(input.path))) throw new Error(STORAGE_MISSING);

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
      processing_status: "ready",
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

export async function claimItemImageProcessing(imageId: string): Promise<ImageProcessClaim | null> {
  if (!UUID_PATTERN.test(imageId)) throw new Error("Unknown photo.");
  const supabase = await getSupabase();
  const existing = await supabase
    .from("item_images")
    .select("id, item_id, storage_path, processing_status, processing_started_at")
    .eq("id", imageId)
    .maybeSingle();
  if (existing.error) throw new Error(errorText(existing.error));
  if (!existing.data) throw new Error("Unknown photo.");
  const status = imageProcessingStatus(existing.data.processing_status);
  const startedAt = typeof existing.data.processing_started_at === "string" ? existing.data.processing_started_at : null;
  if (!processingClaimIsStale(status, startedAt, Date.now())) return null;

  const claimStarted = new Date().toISOString();
  let update = supabase
    .from("item_images")
    .update({
      processing_status: "processing",
      processing_started_at: claimStarted,
      processing_error: null,
    })
    .eq("id", imageId)
    .eq("item_id", existing.data.item_id)
    .eq("processing_status", existing.data.processing_status);
  update = startedAt ? update.eq("processing_started_at", startedAt) : update.is("processing_started_at", null);
  const claimed = await update.select("id, item_id, storage_path, processing_started_at");
  if (claimed.error) throw new Error(errorText(claimed.error));
  const row = claimed.data?.[0];
  if (!row?.storage_path || !row.item_id || !row.processing_started_at) return null;
  const path = String(row.storage_path);
  const itemId = String(row.item_id);
  const started = String(row.processing_started_at);
  try {
    assertOwnedPath(itemId, imageId, path);
    const signed = await supabase.storage.from(ITEM_IMAGE_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(signed.error ? errorText(signed.error) : "Could not download the photo.");
    }
    return { itemId, imageId, storagePath: path, signedUrl: signed.data.signedUrl, startedAt: started };
  } catch (error) {
    const message = errorText(error).replace(/\s+/g, " ").trim().slice(0, 280) || "Could not download the photo.";
    await supabase
      .from("item_images")
      .update({ processing_status: "failed", processing_error: message })
      .eq("id", imageId)
      .eq("processing_status", "processing")
      .eq("processing_started_at", started);
    throw error;
  }
}

export async function reserveProcessedImageUpload(input: {
  itemId: string;
  imageId: string;
  startedAt: string;
  size: number;
}): Promise<ImageUploadTicket> {
  assertIds(input.itemId, input.imageId);
  assertStartedAt(input.startedAt);
  const problem = imageFileError({ name: "processed.jpg", type: "image/jpeg", size: input.size });
  if (problem) throw new Error(problem);
  const supabase = await getSupabase();
  const owned = await supabase
    .from("item_images")
    .select("id")
    .eq("id", input.imageId)
    .eq("item_id", input.itemId)
    .eq("processing_status", "processing")
    .eq("processing_started_at", input.startedAt)
    .maybeSingle();
  if (owned.error) throw new Error(errorText(owned.error));
  if (!owned.data) throw new Error("Photo processing was interrupted.");
  const path = processedImagePath(input.itemId, input.imageId, crypto.randomUUID().replaceAll("-", "").slice(0, 8));
  assertOwnedPath(input.itemId, input.imageId, path);
  const signed = await supabase.storage.from(ITEM_IMAGE_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(signed.error ? errorText(signed.error) : "Could not prepare the photo upload.");
  }
  return { id: input.imageId, path, signedUrl: signed.data.signedUrl, sortOrder: 0 };
}

export async function completeItemImageProcessing(input: {
  itemId: string;
  imageId: string;
  startedAt: string;
  path: string;
}): Promise<void> {
  assertOwnedPath(input.itemId, input.imageId, input.path);
  assertStartedAt(input.startedAt);
  if (!isProcessedImagePath(input.itemId, input.imageId, input.path)) throw new Error("Could not save the photo.");
  if (!(await objectIsStored(input.path))) throw new Error(STORAGE_MISSING);
  const supabase = await getSupabase();
  const existing = await supabase
    .from("item_images")
    .select("storage_path, original_storage_path")
    .eq("id", input.imageId)
    .eq("item_id", input.itemId)
    .eq("processing_status", "processing")
    .eq("processing_started_at", input.startedAt)
    .maybeSingle();
  if (existing.error) throw new Error(errorText(existing.error));
  if (!existing.data) throw new Error("Photo processing was interrupted.");
  const updated = await supabase
    .from("item_images")
    .update({
      storage_path: input.path,
      processing_status: "ready",
      processing_error: null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", input.imageId)
    .eq("item_id", input.itemId)
    .eq("processing_status", "processing")
    .eq("processing_started_at", input.startedAt)
    .select("id");
  if (updated.error) throw new Error(errorText(updated.error));
  if (!updated.data || updated.data.length === 0) throw new Error("Photo processing was interrupted.");
  const previous = typeof existing.data.storage_path === "string" ? existing.data.storage_path : "";
  const original = typeof existing.data.original_storage_path === "string" ? existing.data.original_storage_path : "";
  if (previous && original && previous !== original && previous !== input.path) {
    await supabase.storage.from(ITEM_IMAGE_BUCKET).remove([previous]);
  }
}

export async function failItemImageProcessing(input: {
  imageId: string;
  startedAt: string;
  message: string;
}): Promise<boolean> {
  if (!UUID_PATTERN.test(input.imageId) || !/^[0-9TZ.: +-]{10,40}$/.test(input.startedAt)) return false;
  const message = input.message.replace(/\s+/g, " ").trim().slice(0, 280) || "Photo processing failed.";
  const supabase = await getSupabase();
  const updated = await supabase
    .from("item_images")
    .update({ processing_status: "failed", processing_error: message })
    .eq("id", input.imageId)
    .eq("processing_status", "processing")
    .eq("processing_started_at", input.startedAt)
    .select("id");
  if (updated.error) return false;
  return (updated.data ?? []).length > 0;
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
