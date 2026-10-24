"use server";

import { errorText } from "@/lib/errors";
import { withDeadline } from "@/lib/deadline";
import { operatorInitials } from "@/lib/stockAccess";
import {
  parseSoAttachmentKind,
  soPdfDisplayName,
  soPdfFileError,
  SO_ATTACHMENT_LIMIT,
  SO_DOCUMENT_BUCKET,
  type SoAttachmentKind,
} from "@/lib/soAttachmentKinds";
import { salesOperatorId, salesPageAccess } from "@/lib/salesSession";
import { getSupabase } from "@/lib/supabase";

const SIGNED_URL_SECONDS = 60 * 60;
const STORAGE_CHECK_MS = 8_000;
const STORAGE_MISSING = "The PDF did not finish uploading.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDIT_DENIED = "You cannot change a sales order.";

export type SoAttachmentView = {
  id: string;
  kind: SoAttachmentKind;
  fileName: string;
  url: string | null;
};

export type SoAttachmentTicket = {
  id: string;
  path: string;
  signedUrl: string;
};

export async function loadSoAttachments(orderId: string): Promise<SoAttachmentView[]> {
  if (!UUID.test(orderId)) return [];
  const access = await salesPageAccess();
  if (!access.canViewMoney) return [];
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("so_attachments")
    .select("id, kind, file_name, storage_path")
    .eq("sales_order_id", orderId)
    .order("created_at");
  if (error) throw new Error(errorText(error));
  const rows = data ?? [];
  const urls = await signedAttachmentUrls(rows.map((row) => String(row.storage_path)));
  return rows.flatMap((row) => {
    const kind = parseSoAttachmentKind(String(row.kind));
    if (!kind) return [];
    const path = String(row.storage_path);
    return [{ id: String(row.id), kind, fileName: String(row.file_name), url: urls.get(path) ?? null }];
  });
}

export async function reserveSoAttachmentUpload(
  orderId: string,
  file: { name: string; type: string; size: number; kind: string },
): Promise<SoAttachmentTicket> {
  const access = await salesPageAccess();
  if (!access.canEdit || !access.canViewMoney) throw new Error(EDIT_DENIED);
  const kind = parseSoAttachmentKind(file.kind);
  if (!kind) throw new Error("Choose a file type.");
  const problem = soPdfFileError(file);
  if (problem) throw new Error(problem);
  await assertAttachmentRoom(orderId);
  const id = crypto.randomUUID();
  const path = attachmentPath(orderId, id);
  const supabase = await getSupabase();
  const signed = await supabase.storage.from(SO_DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(signed.error ? errorText(signed.error) : "Could not prepare the PDF upload.");
  }
  return { id, path, signedUrl: signed.data.signedUrl };
}

export async function commitSoAttachmentUpload(input: {
  orderId: string;
  id: string;
  path: string;
  kind: string;
  fileName: string;
  byteSize: number;
}): Promise<void> {
  const access = await salesPageAccess();
  if (!access.canEdit || !access.canViewMoney) throw new Error(EDIT_DENIED);
  const kind = parseSoAttachmentKind(input.kind);
  if (!kind) throw new Error("Choose a file type.");
  if (input.path !== attachmentPath(input.orderId, input.id)) throw new Error("Unknown file.");
  const problem = soPdfFileError({ name: input.fileName, type: "application/pdf", size: input.byteSize });
  if (problem) throw new Error(problem);
  await assertAttachmentRoom(input.orderId);
  if (!(await objectIsStored(input.path))) throw new Error(STORAGE_MISSING);
  const operatorId = await salesOperatorId();
  const label = await operatorInitials();
  const supabase = await getSupabase();
  const { error } = await supabase.from("so_attachments").insert({
    id: input.id,
    sales_order_id: input.orderId,
    kind,
    file_name: soPdfDisplayName(input.fileName),
    storage_path: input.path,
    byte_size: input.byteSize,
    operator_id: operatorId,
    operator_label: label,
  });
  if (error) throw new Error(errorText(error));
  await logAttachmentEvent(input.orderId, "attachment_added", soPdfDisplayName(input.fileName), operatorId, label);
}

export async function discardSoAttachmentUpload(path: string): Promise<void> {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i.test(path)) return;
  await (await getSupabase()).storage.from(SO_DOCUMENT_BUCKET).remove([path]);
}

export async function deleteSoAttachment(orderId: string, attachmentId: string): Promise<void> {
  const access = await salesPageAccess();
  if (!access.canEdit || !access.canViewMoney) throw new Error(EDIT_DENIED);
  if (!UUID.test(orderId) || !UUID.test(attachmentId)) throw new Error("Unknown file.");
  await assertOpenOrder(orderId);
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("so_attachments")
    .select("id, storage_path, file_name")
    .eq("id", attachmentId)
    .eq("sales_order_id", orderId)
    .maybeSingle();
  if (error) throw new Error(errorText(error));
  if (!data) throw new Error("Unknown file.");
  const removed = await supabase.storage.from(SO_DOCUMENT_BUCKET).remove([String(data.storage_path)]);
  if (removed.error) throw new Error(errorText(removed.error));
  const deleted = await supabase.from("so_attachments").delete().eq("id", attachmentId).eq("sales_order_id", orderId);
  if (deleted.error) throw new Error(errorText(deleted.error));
  await logAttachmentEvent(orderId, "attachment_removed", String(data.file_name), await salesOperatorId(), await operatorInitials());
}

async function logAttachmentEvent(
  orderId: string,
  event: string,
  note: string,
  operatorId: string | null,
  label: string,
): Promise<void> {
  const { error } = await (await getSupabase()).from("so_events").insert({
    sales_order_id: orderId,
    event,
    note,
    operator_id: operatorId,
    operator_label: label,
  });
  if (error) throw new Error(errorText(error));
}

async function signedAttachmentUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return urls;
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage.from(SO_DOCUMENT_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error) throw new Error(errorText(error));
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl);
  }
  return urls;
}

async function objectIsStored(path: string): Promise<boolean> {
  const supabase = await getSupabase();
  const found = await withDeadline(
    supabase.storage.from(SO_DOCUMENT_BUCKET).exists(path),
    STORAGE_CHECK_MS,
    STORAGE_MISSING,
  );
  if (found.data) return true;
  if (!found.error) return false;
  const status = "status" in found.error ? Number(found.error.status) : undefined;
  if (status === 400 || status === 404) return false;
  throw new Error(errorText(found.error));
}

async function assertAttachmentRoom(orderId: string): Promise<void> {
  await assertOpenOrder(orderId);
  const { count, error } = await (await getSupabase())
    .from("so_attachments")
    .select("id", { count: "exact", head: true })
    .eq("sales_order_id", orderId);
  if (error) throw new Error(errorText(error));
  if ((count ?? 0) >= SO_ATTACHMENT_LIMIT) throw new Error("A sales order can have at most 20 files.");
}

async function assertOpenOrder(orderId: string): Promise<void> {
  if (!UUID.test(orderId)) throw new Error("Sales order not found.");
  const { data, error } = await (await getSupabase())
    .from("sales_orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(errorText(error));
  if (!data) throw new Error("Sales order not found.");
  if (data.status === "cancelled" || data.status === "closed") {
    throw new Error("That sales order can no longer be changed.");
  }
}

function attachmentPath(orderId: string, id: string): string {
  if (!UUID.test(orderId) || !UUID.test(id)) throw new Error("Unknown file.");
  return `${orderId}/${id}.pdf`;
}
