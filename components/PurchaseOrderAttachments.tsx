"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { errorText } from "@/lib/errors";
import { attachmentKindLabel, PO_ATTACHMENT_KINDS } from "@/lib/poAttachmentKinds";
import { deletePoAttachment, type PoAttachmentView } from "@/lib/poAttachments";
import { uploadPoAttachments } from "@/lib/poAttachmentUpload";

export function PurchaseOrderAttachments({
  orderId,
  attachments,
  canEdit,
}: {
  orderId: string | null;
  attachments: PoAttachmentView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<string>(PO_ATTACHMENT_KINDS[0].id);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | null) {
    if (!orderId || !files || files.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await uploadPoAttachments(orderId, kind, [...files]);
      router.refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(attachment: PoAttachmentView) {
    if (!orderId || !window.confirm(`Remove ${attachment.fileName}?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await deletePoAttachment(orderId, attachment.id);
      router.refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="po-files">
      <legend>Files</legend>
      {orderId == null ? <p className="hint">Save the purchase order before attaching a file.</p> : null}
      {attachments.length === 0 ? <p className="muted">No files yet.</p> : null}
      {attachments.length > 0 ? (
        <ul className="po-file-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <span className={`badge badge-file badge-file-${attachment.kind}`}>{attachmentKindLabel(attachment.kind)}</span>
              {attachment.url ? (
                <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                  {attachment.fileName}
                </a>
              ) : (
                <span>{attachment.fileName}</span>
              )}
              {canEdit && orderId ? (
                <button
                  type="button"
                  className="secondary icon-button"
                  disabled={busy}
                  aria-label={`Remove ${attachment.fileName}`}
                  title={`Remove ${attachment.fileName}`}
                  onClick={() => void remove(attachment)}
                >
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit && orderId ? (
        <div className="po-file-add">
          <label>
            Type
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              {PO_ATTACHMENT_KINDS.map((option) => (
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
      <p className="hint">Vendor invoice, quote, order confirmation, or other. PDF only. Not a customer document.</p>
      {message ? (
        <p className="banner error" role="alert">
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}
