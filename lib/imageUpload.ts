import { withDeadline } from "@/lib/deadline";
import { errorText } from "@/lib/errors";
import {
  commitEditedImage,
  commitItemImageUpload,
  discardItemImage,
  reserveEditedImageUpload,
  reserveItemImageUpload,
  signedItemImageUrl,
} from "@/lib/images";

const UPLOAD_MS = 60_000;
const SAVE_MS = 20_000;
const DOWNLOAD_MS = 45_000;
const UPLOAD_TIMEOUT = "The photo upload timed out. Try again.";
const SAVE_TIMEOUT = "Saving the photo timed out. Try again.";
const DOWNLOAD_TIMEOUT = "The photo download timed out. Try again.";

async function putSignedUpload(signedUrl: string, file: Blob): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_MS);
  try {
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    const response = await fetch(signedUrl, {
      method: "PUT",
      headers: { "x-upsert": "false" },
      body,
      signal: controller.signal,
    });
    await response.text().catch(() => undefined);
    if (!response.ok) throw new Error("Could not upload the photo.");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(UPLOAD_TIMEOUT);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Uploads each file straight to Storage, then records the row. Bytes stay off the server action. */
export async function uploadItemImages(itemId: string, files: File[]): Promise<void> {
  for (const file of files) {
    const ticket = await withDeadline(
      reserveItemImageUpload(itemId, { name: file.name, type: file.type, size: file.size }),
      SAVE_MS,
      SAVE_TIMEOUT,
    );
    try {
      await putSignedUpload(ticket.signedUrl, file);
      await withDeadline(
        commitItemImageUpload({
          itemId,
          id: ticket.id,
          path: ticket.path,
          sortOrder: ticket.sortOrder,
        }),
        SAVE_MS,
        SAVE_TIMEOUT,
      );
    } catch (error) {
      await withDeadline(discardItemImage(ticket.path), SAVE_MS, SAVE_TIMEOUT).catch(() => undefined);
      throw error instanceof Error ? error : new Error(errorText(error));
    }
  }
}

export async function downloadItemImage(storagePath: string): Promise<Blob> {
  const url = await withDeadline(signedItemImageUrl(storagePath), SAVE_MS, DOWNLOAD_TIMEOUT);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("Could not download the photo.");
    return await response.blob();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(DOWNLOAD_TIMEOUT);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function saveEditedImage(input: {
  itemId: string;
  sourceImageId: string;
  blob: Blob;
}): Promise<string> {
  const type = input.blob.type === "image/png" ? "image/png" : "image/jpeg";
  const ticket = await withDeadline(
    reserveEditedImageUpload({
      itemId: input.itemId,
      sourceImageId: input.sourceImageId,
      type,
      size: input.blob.size,
    }),
    SAVE_MS,
    SAVE_TIMEOUT,
  );
  try {
    await putSignedUpload(ticket.signedUrl, input.blob);
    await withDeadline(
      commitEditedImage({
        itemId: input.itemId,
        sourceImageId: input.sourceImageId,
        id: ticket.id,
        path: ticket.path,
      }),
      SAVE_MS,
      SAVE_TIMEOUT,
    );
    return ticket.id;
  } catch (error) {
    await withDeadline(discardItemImage(ticket.path), SAVE_MS, SAVE_TIMEOUT).catch(() => undefined);
    throw error instanceof Error ? error : new Error(errorText(error));
  }
}
