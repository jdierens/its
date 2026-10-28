"use server";

import { authRequired } from "@/lib/authRequired";
import { withDeadline } from "@/lib/deadline";
import { errorText } from "@/lib/errors";
import {
  ITEM_ATTACHMENT_LIMIT,
  ITEM_DOCUMENT_BUCKET,
  itemAttachmentsUnavailable,
  itemPdfDisplayName,
  itemPdfFileError,
  parseItemAttachmentKind,
  type ItemAttachmentKind,
} from "@/lib/itemAttachmentKinds";
import { operatorInitials } from "@/lib/stockAccess";
import { getSupabase } from "@/lib/supabase";
import { sessionUser } from "@/lib/sessionUser";

const SIGNED_URL_SECONDS = 60 * 60;
const STORAGE_CHECK_MS = 8_000;
const STORAGE_MISSING = "The PDF did not finish uploading.";
const NOT_READY = "Item documents are not set up yet.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ItemAttachmentView = {
  id: string;
  kind: ItemAttachmentKind;
  fileName: string;
  url: string | null;
};

export type ItemAttachmentList = {
  rows: ItemAttachmentView[];
  available: boolean;
};

export type ItemAttachmentTicket = {
  id: string;
  path: string;
  signedUrl: string;
};

export async function loadItemAttachments(itemId: string): Promise<ItemAttachmentList> {
  if (!UUID.test(itemId)) return { rows: [], available: true };
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("item_attachments")
    .select("id, kind, file_name, storage_path")
    .eq("item_id", itemId)
    .order("created_at");
  if (error) {
    if (itemAttachmentsUnavailable(error)) return { rows: [], available: false };
    throw new Error(errorText(error));
  }
  const rows = data ?? [];
  const urls = await signedAttachmentUrls(rows.map((row) => String(row.storage_path)));
  return {
    available: true,
    rows: rows.flatMap((row) => {
      const kind = parseItemAttachmentKind(String(row.kind));
      if (!kind) return [];
      const path = String(row.storage_path);
      return [{ id: String(row.id), kind, fileName: String(row.file_name), url: urls.get(path) ?? null }];
    }),
  };
}

export async function reserveItemAttachmentUpload(
  itemId: string,
  file: { name: string; type: string; size: number; kind: string },
): Promise<ItemAttachmentTicket> {
  const kind = parseItemAttachmentKind(file.kind);
  if (!kind) throw new Error("Choose a file type.");
  const problem = itemPdfFileError(file);
  if (problem) throw new Error(problem);
  await assertAttachmentRoom(itemId);
  const id = crypto.randomUUID();
  const path = attachmentPath(itemId, id);
  const supabase = await getSupabase();
  const signed = await supabase.storage.from(ITEM_DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(signed.error ? errorText(signed.error) : "Could not prepare the PDF upload.");
  }
  return { id, path, signedUrl: signed.data.signedUrl };
}

export async function commitItemAttachmentUpload(input: {
  itemId: string;
  id: string;
  path: string;
  kind: string;
  fileName: string;
  byteSize: number;
}): Promise<void> {
  const kind = parseItemAttachmentKind(input.kind);
  if (!kind) throw new Error("Choose a file type.");
  if (input.path !== attachmentPath(input.itemId, input.id)) throw new Error("Unknown file.");
  const problem = itemPdfFileError({ name: input.fileName, type: "application/pdf", size: input.byteSize });
  if (problem) throw new Error(problem);
  await assertAttachmentRoom(input.itemId);
  if (!(await objectIsStored(input.path))) throw new Error(STORAGE_MISSING);
  const operator = await attachmentOperator();
  const supabase = await getSupabase();
  const { error } = await supabase.from("item_attachments").insert({
    id: input.id,
    item_id: input.itemId,
    kind,
    file_name: itemPdfDisplayName(input.fileName),
    storage_path: input.path,
    byte_size: input.byteSize,
    operator_id: operator.id,
    operator_label: operator.label,
  });
  if (error) throw attachmentError(error);
}

export async function discardItemAttachmentUpload(path: string): Promise<void> {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i.test(path)) return;
  await (await getSupabase()).storage.from(ITEM_DOCUMENT_BUCKET).remove([path]);
}

export async function deleteItemAttachment(itemId: string, attachmentId: string): Promise<void> {
  if (!UUID.test(itemId) || !UUID.test(attachmentId)) throw new Error("Unknown file.");
  await assertItem(itemId);
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("item_attachments")
    .select("id, storage_path, file_name")
    .eq("id", attachmentId)
    .eq("item_id", itemId)
    .maybeSingle();
  if (error) throw attachmentError(error);
  if (!data) throw new Error("Unknown file.");
  const removed = await supabase.storage.from(ITEM_DOCUMENT_BUCKET).remove([String(data.storage_path)]);
  if (removed.error) throw new Error(errorText(removed.error));
  const deleted = await supabase.from("item_attachments").delete().eq("id", attachmentId).eq("item_id", itemId);
  if (deleted.error) throw attachmentError(deleted.error);
}

async function attachmentOperator(): Promise<{ id: string | null; label: string }> {
  const label = await operatorInitials();
  if (!authRequired()) return { id: null, label };
  const session = await sessionUser();
  if (!session) throw new Error("Sign in required.");
  return { id: session.id, label };
}

async function signedAttachmentUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return urls;
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage.from(ITEM_DOCUMENT_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error) throw new Error(errorText(error));
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl);
  }
  return urls;
}

async function objectIsStored(path: string): Promise<boolean> {
  const supabase = await getSupabase();
  const found = await withDeadline(
    supabase.storage.from(ITEM_DOCUMENT_BUCKET).exists(path),
    STORAGE_CHECK_MS,
    STORAGE_MISSING,
  );
  if (found.data) return true;
  if (!found.error) return false;
  const status = "status" in found.error ? Number(found.error.status) : undefined;
  if (status === 400 || status === 404) return false;
  throw new Error(errorText(found.error));
}

async function assertAttachmentRoom(itemId: string): Promise<void> {
  await assertItem(itemId);
  const { count, error } = await (await getSupabase())
    .from("item_attachments")
    .select("id", { count: "exact", head: true })
    .eq("item_id", itemId);
  if (error) throw attachmentError(error);
  if ((count ?? 0) >= ITEM_ATTACHMENT_LIMIT) throw new Error("An item can have at most 20 files.");
}

async function assertItem(itemId: string): Promise<void> {
  if (!UUID.test(itemId)) throw new Error("Item not found.");
  const { data, error } = await (await getSupabase()).from("items").select("id").eq("id", itemId).maybeSingle();
  if (error) throw new Error(errorText(error));
  if (!data) throw new Error("Item not found.");
}

function attachmentError(error: { code?: string; message?: string }): Error {
  if (itemAttachmentsUnavailable(error)) return new Error(NOT_READY);
  return new Error(errorText(error));
}

function attachmentPath(itemId: string, id: string): string {
  if (!UUID.test(itemId) || !UUID.test(id)) throw new Error("Unknown file.");
  return `${itemId}/${id}.pdf`;
}
