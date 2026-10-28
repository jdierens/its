"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { errorText } from "@/lib/errors";
import { ITEM_ATTACHMENT_KINDS, itemAttachmentKindLabel } from "@/lib/itemAttachmentKinds";
import { deleteItemAttachment, loadItemAttachments, type ItemAttachmentView } from "@/lib/itemAttachments";
import { uploadItemAttachments } from "@/lib/itemAttachmentUpload";

export function ItemAttachments({ itemId }: { itemId?: string }) {
  const [kind, setKind] = useState<string>(ITEM_ATTACHMENT_KINDS[0].id);
  const [rows, setRows] = useState<ItemAttachmentView[]>([]);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!itemId) {
      setRows([]);
      setAvailable(true);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    loadItemAttachments(itemId)
      .then((list) => {
        if (cancelled) return;
        setRows(list.rows);
        setAvailable(list.available);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMessage(errorText(error));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  async function reload() {
    if (!itemId) return;
    const list = await loadItemAttachments(itemId);
    setRows(list.rows);
    setAvailable(list.available);
  }

  async function upload(files: FileList | null) {
    if (!itemId || !files || files.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await uploadItemAttachments(itemId, kind, [...files]);
      await reload();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(attachment: ItemAttachmentView) {
    if (!itemId || !window.confirm(`Remove ${attachment.fileName}?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteItemAttachment(itemId, attachment.id);
      await reload();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const canAdd = Boolean(itemId) && available;

  return (
    <fieldset className="item-files">
      <legend>Attachments</legend>
      {itemId == null ? <p className="hint">Save the item before attaching a file.</p> : null}
      {itemId && loaded && !available ? (
        <p className="hint">Item documents are not set up yet. Apply the item attachments migration, then refresh.</p>
      ) : null}
      {itemId && loaded && available && rows.length === 0 ? <p className="muted">No files yet.</p> : null}
      {rows.length > 0 ? (
        <ul className="item-file-list">
          {rows.map((attachment) => (
            <li key={attachment.id}>
              <span className={`badge badge-file badge-file-${attachment.kind}`}>
                {itemAttachmentKindLabel(attachment.kind)}
              </span>
              {attachment.url ? (
                <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                  {attachment.fileName}
                </a>
              ) : (
                <span>{attachment.fileName}</span>
              )}
              {canAdd ? (
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
      {canAdd ? (
        <div className="item-file-add">
          <label>
            Type
            <select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value)}>
              {ITEM_ATTACHMENT_KINDS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="button secondary file-button icon-button" title="Add PDF" aria-label="Add PDF">
            <Plus size={16} strokeWidth={1.75} aria-hidden />
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
      {canAdd ? (
        <p className="hint">Product brief, data sheet, manual, or other. PDF only, in the private item bucket.</p>
      ) : null}
      {message ? (
        <p className="banner error" role="alert">
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}
