import { withDeadline } from "@/lib/deadline";
import {
  commitItemAttachmentUpload,
  discardItemAttachmentUpload,
  reserveItemAttachmentUpload,
} from "@/lib/itemAttachments";

const UPLOAD_MS = 60_000;
const SAVE_MS = 20_000;
const UPLOAD_TIMEOUT = "The PDF upload timed out. Try again.";
const SAVE_TIMEOUT = "Saving the PDF timed out. Try again.";

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
    if (!response.ok) throw new Error("Could not upload the PDF.");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(UPLOAD_TIMEOUT);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Uploads each PDF straight to Storage, then records the row. Bytes stay off the server action. */
export async function uploadItemAttachments(itemId: string, kind: string, files: File[]): Promise<void> {
  for (const file of files) {
    const ticket = await withDeadline(
      reserveItemAttachmentUpload(itemId, { name: file.name, type: file.type, size: file.size, kind }),
      SAVE_MS,
      SAVE_TIMEOUT,
    );
    try {
      await putSignedUpload(ticket.signedUrl, file);
      await withDeadline(
        commitItemAttachmentUpload({
          itemId,
          id: ticket.id,
          path: ticket.path,
          kind,
          fileName: file.name,
          byteSize: file.size,
        }),
        SAVE_MS,
        SAVE_TIMEOUT,
      );
    } catch (error) {
      await discardItemAttachmentUpload(ticket.path).catch(() => undefined);
      throw error;
    }
  }
}
