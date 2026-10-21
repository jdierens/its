import { errorText } from "@/lib/errors";
import {
  commitEditedImage,
  commitItemImageUpload,
  discardItemImage,
  reserveEditedImageUpload,
  reserveItemImageUpload,
  signedItemImageUrl,
} from "@/lib/images";

async function putSignedUpload(signedUrl: string, file: Blob): Promise<void> {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  const response = await fetch(signedUrl, {
    method: "PUT",
    headers: { "x-upsert": "false" },
    body,
  });
  if (!response.ok) throw new Error("Could not upload the photo.");
}

/** Uploads each file straight to Storage, then records the row. Bytes stay off the server action. */
export async function uploadItemImages(itemId: string, files: File[]): Promise<void> {
  for (const file of files) {
    const ticket = await reserveItemImageUpload(itemId, { name: file.name, type: file.type, size: file.size });
    try {
      await putSignedUpload(ticket.signedUrl, file);
      await commitItemImageUpload({
        itemId,
        id: ticket.id,
        path: ticket.path,
        sortOrder: ticket.sortOrder,
      });
    } catch (error) {
      await discardItemImage(ticket.path).catch(() => undefined);
      throw error instanceof Error ? error : new Error(errorText(error));
    }
  }
}

export async function downloadItemImage(storagePath: string): Promise<Blob> {
  const url = await signedItemImageUrl(storagePath);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download the photo.");
  return response.blob();
}

export async function saveEditedImage(input: {
  itemId: string;
  sourceImageId: string;
  blob: Blob;
}): Promise<string> {
  const type = input.blob.type === "image/png" ? "image/png" : "image/jpeg";
  const ticket = await reserveEditedImageUpload({
    itemId: input.itemId,
    sourceImageId: input.sourceImageId,
    type,
    size: input.blob.size,
  });
  try {
    await putSignedUpload(ticket.signedUrl, input.blob);
    await commitEditedImage({
      itemId: input.itemId,
      sourceImageId: input.sourceImageId,
      id: ticket.id,
      path: ticket.path,
    });
    return ticket.id;
  } catch (error) {
    await discardItemImage(ticket.path).catch(() => undefined);
    throw error instanceof Error ? error : new Error(errorText(error));
  }
}
