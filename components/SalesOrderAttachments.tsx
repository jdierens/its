"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { errorText } from "@/lib/errors";
import { SO_ATTACHMENT_KINDS, soAttachmentKindLabel } from "@/lib/soAttachmentKinds";
import { deleteSoAttachment, type SoAttachmentView } from "@/lib/soAttachments";
import { uploadSoAttachments } from "@/lib/soAttachmentUpload";

export function SalesOrderAttachments({
  orderId,
  attachments,
  canEdit,
}: {
  orderId: string | null;
  attachments: SoAttachmentView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<string>("customer_po");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | null) {
    if (!orderId || !files || files.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await uploadSoAttachments(orderId, kind, [...files]);
      router.refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(attachment: SoAttachmentView) {
    if (!orderId || !window.confirm(`Remove ${attachment.fileName}?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteSoAttachment(orderId, attachment.id);
      router.refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="so-files">
      <legend>Files</legend>
      {orderId == null ? <p className="hint">Save the order before attaching a file.</p> : null}
      {attachments.length === 0 ? <p className="muted">No files yet.</p> : null}
      {attachments.length > 0 ? (
        <ul className="so-file-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <span className="badge badge-neutral">{soAttachmentKindLabel(attachment.kind)}</span>
              {attachment.url ? (
                <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                  {attachment.fileName}
                </a>
              ) : (
                <span>{attachment.fileName}</span>
              )}
              {canEdit && orderId ? (
                <button type="button" className="secondary" disabled={busy} onClick={() => void remove(attachment)}>
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit && orderId ? (
        <div className="so-file-add">
          <label>
            Type
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              {SO_ATTACHMENT_KINDS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              disabled={busy}
              onChange={(event) => {
                void upload(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      ) : null}
      <p className="hint">Customer PO is the usual file. PDF only, in the private sales-order bucket.</p>
      {message ? (
        <p className="banner error" role="alert">
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}
