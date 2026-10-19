"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DragEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { linkAttributes } from "@/lib/attributes";
import { errorText } from "@/lib/errors";
import {
  countTaxonomyItems,
  createTaxonomy,
  deleteTaxonomy,
  fetchTaxonomies,
  saveTaxonomyOrder,
  updateTaxonomy,
} from "@/lib/items";
import type { Attribute, Taxonomy } from "@/lib/types";

const LONG_CODE = /^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/;
const SHORT_CODE = /^[A-Z0-9]{3}$/;

type SavedCodes = {
  name: string;
  longCode: string;
  shortCode: string;
};

function cleanCode(value: string): string {
  return value.trim().toUpperCase();
}

function snapshot(row: Taxonomy): SavedCodes {
  return {
    name: row.name,
    longCode: row.longCode ?? "",
    shortCode: row.shortCode ?? "",
  };
}

function isDirty(row: Taxonomy, saved: SavedCodes | undefined): boolean {
  if (!saved) return false;
  return (
    row.name !== saved.name ||
    (row.longCode ?? "") !== saved.longCode ||
    (row.shortCode ?? "") !== saved.shortCode
  );
}

export function TaxonomiesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Taxonomy[]>([]);
  const [saved, setSaved] = useState<Record<string, SavedCodes>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftLong, setDraftLong] = useState("");
  const [draftShort, setDraftShort] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [linkFailureId, setLinkFailureId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Taxonomy | null>(null);
  const [deleting, setDeleting] = useState(false);
  const orderLock = useRef(false);
  const dirtyRef = useRef(false);

  const source = rows.find((row) => row.id === sourceId) ?? null;
  const dialogDirty =
    dialogOpen &&
    (draftName.trim() !== "" || draftLong.trim() !== "" || draftShort.trim() !== "" || selectedFields.length > 0);
  const anyDirty = rows.some((row) => isDirty(row, saved[row.id])) || dialogDirty;
  dirtyRef.current = anyDirty;

  const selectedAttributes = useMemo(() => {
    const byId = new Map<string, Attribute>();
    for (const row of rows) {
      for (const attribute of row.attributes) byId.set(attribute.id, attribute);
    }
    return selectedFields.flatMap((id) => {
      const attribute = byId.get(id);
      return attribute ? [attribute] : [];
    });
  }, [rows, selectedFields]);

  useEffect(() => {
    let cancelled = false;
    fetchTaxonomies()
      .then((taxonomies) => {
        if (cancelled) return;
        setRows(taxonomies);
        setSaved(Object.fromEntries(taxonomies.map((row) => [row.id, snapshot(row)])));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onLeave(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!dirtyRef.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor || anchor.target === "_blank" || !anchor.getAttribute("href")) return;
      if (!window.confirm("You have unsaved name or code changes. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !creating) {
        event.stopPropagation();
        setDialogOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creating, dialogOpen]);

  function updateRow(id: string, patch: Partial<Taxonomy>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setStatus(null);
    setSavedFlash((current) => (current === id ? null : current));
  }

  function revertRow(id: string) {
    const baseline = saved[id];
    if (!baseline) return;
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              name: baseline.name,
              longCode: baseline.longCode || null,
              shortCode: baseline.shortCode || null,
            }
          : row,
      ),
    );
    setError(null);
  }

  function onRowKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, row: Taxonomy) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (isDirty(row, saved[row.id])) void saveRow(row);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      revertRow(row.id);
    }
  }

  async function persistOrder(next: Taxonomy[]) {
    const ordered = next.map((row, index) => ({ ...row, sortOrder: index + 1 }));
    setRows(ordered);
    setSavingOrder(true);
    setError(null);
    setStatus(null);
    try {
      await saveTaxonomyOrder(ordered.map((row) => row.id));
      setStatus("Order saved.");
    } catch (err) {
      setError(errorText(err));
      try {
        const taxonomies = await fetchTaxonomies();
        setRows(taxonomies);
        setSaved(Object.fromEntries(taxonomies.map((row) => [row.id, snapshot(row)])));
      } catch (reloadError) {
        setError(errorText(reloadError));
      }
    } finally {
      setSavingOrder(false);
    }
  }

  function move(fromId: string, toIndex: number) {
    if (orderLock.current || savingOrder) return;
    const fromIndex = rows.findIndex((row) => row.id === fromId);
    if (fromIndex < 0 || toIndex < 0 || toIndex >= rows.length || fromIndex === toIndex) return;
    const next = rows.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    orderLock.current = true;
    void persistOrder(next).finally(() => {
      orderLock.current = false;
    });
  }

  function onDrop(event: DragEvent<HTMLTableRowElement>, toId: string) {
    event.preventDefault();
    const fromId = event.dataTransfer.getData("text/plain") || dragId;
    setDragId(null);
    setOverId(null);
    if (!fromId) return;
    const toIndex = rows.findIndex((row) => row.id === toId);
    move(fromId, toIndex);
  }

  async function saveRow(row: Taxonomy) {
    const name = row.name.trim();
    const longCode = row.longCode ? cleanCode(row.longCode) : "";
    const shortCode = row.shortCode ? cleanCode(row.shortCode) : "";
    if (!name) {
      setError("Name is required.");
      return;
    }
    if (longCode && !LONG_CODE.test(longCode)) {
      setError("Long code must be uppercase letters, digits, and slashes, like CRD/NIC.");
      return;
    }
    if (shortCode && !SHORT_CODE.test(shortCode)) {
      setError("Short code must be exactly 3 letters or digits.");
      return;
    }

    setSavingId(row.id);
    setError(null);
    setStatus(null);
    try {
      await updateTaxonomy(row.id, {
        name,
        longCode: longCode || null,
        shortCode: shortCode || null,
      });
      const next = { name, longCode, shortCode };
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? { ...item, name, longCode: longCode || null, shortCode: shortCode || null }
            : item,
        ),
      );
      setSaved((current) => ({ ...current, [row.id]: next }));
      setSavedFlash(row.id);
      window.setTimeout(() => {
        setSavedFlash((current) => (current === row.id ? null : current));
      }, 2000);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingId(null);
    }
  }

  function openDialog() {
    setDraftName("");
    setDraftLong("");
    setDraftShort("");
    setSourceId("");
    setSelectedFields([]);
    setError(null);
    setDialogOpen(true);
  }

  function chooseSource(id: string) {
    setSourceId(id);
    const next = rows.find((row) => row.id === id);
    setSelectedFields(next ? next.attributes.map((attribute) => attribute.id) : []);
  }

  function toggleField(id: string) {
    setSelectedFields((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function createRow() {
    const name = draftName.trim();
    const longCode = cleanCode(draftLong);
    const shortCode = cleanCode(draftShort);
    if (!name) {
      setError("Name is required.");
      return;
    }
    if (!LONG_CODE.test(longCode)) {
      setError("Long code must be uppercase letters, digits, and slashes, like CRD/NIC.");
      return;
    }
    if (!SHORT_CODE.test(shortCode)) {
      setError("Short code must be exactly 3 letters or digits.");
      return;
    }
    const names = new Set(selectedAttributes.map((attribute) => attribute.name.toLowerCase()));
    if (names.size !== selectedAttributes.length) {
      setError("Start with one field of each name. Two fields named the same cannot share a taxonomy.");
      return;
    }

    setCreating(true);
    setError(null);
    setLinkFailureId(null);
    try {
      const id = await createTaxonomy({ name, longCode, shortCode });
      if (selectedFields.length > 0) {
        try {
          await linkAttributes(id, selectedFields);
        } catch (err) {
          setDialogOpen(false);
          setLinkFailureId(id);
          setError(
            `The taxonomy was created, but its fields were not linked. ${errorText(err)}`,
          );
          return;
        }
      }
      setDialogOpen(false);
      router.push(`/taxonomies/${id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  async function askDelete(row: Taxonomy) {
    setError(null);
    setStatus(null);
    try {
      const count = await countTaxonomyItems(row.id);
      if (count > 0) {
        setError(
          count === 1
            ? "Can't delete this taxonomy. 1 item uses it."
            : `Can't delete this taxonomy. ${count} items use it.`,
        );
        return;
      }
      setPendingDelete(row);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteTaxonomy(pendingDelete.id);
      setRows((current) => current.filter((row) => row.id !== pendingDelete.id));
      setSaved((current) => {
        const next = { ...current };
        delete next[pendingDelete.id];
        return next;
      });
      setStatus(`Deleted ${pendingDelete.name}. Its field definitions were kept.`);
      setPendingDelete(null);
    } catch (err) {
      setError(errorText(err));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="page">
      <div className="page-toolbar">
        <button type="button" onClick={openDialog}>
          New taxonomy
        </button>
      </div>
      <p className="hint page-note">
        Codes are stored in uppercase. The short code is exactly 3 characters and is printed on the
        label. Drag a row, or use Up and Down, to set the order used in taxonomy lists. That order
        saves on its own. Save changes appears when a name or code has been edited. Fields opens
        that taxonomy&apos;s shared attributes and allowed values. Delete is available only when no
        items use the taxonomy, and it keeps the field definitions.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {linkFailureId ? (
        <p className="hint">
          <Link href={`/taxonomies/${linkFailureId}`}>Open its Fields page</Link> to link them there.
        </p>
      ) : null}
      {status ? <p className="banner ok">{status}</p> : null}
      {loading ? <p className="muted">Loading taxonomies…</p> : null}
      {!loading && rows.length === 0 ? <p className="muted">No taxonomies yet.</p> : null}
      {rows.length > 0 ? (
        <div className="card">
          <table className="taxonomy-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Name</th>
                <th>Long code</th>
                <th>Short code</th>
                <th>Fields</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const dirty = isDirty(row, saved[row.id]);
                return (
                  <tr
                    key={row.id}
                    className={[overId === row.id ? "drop-target" : "", dirty ? "row-dirty" : ""]
                      .filter(Boolean)
                      .join(" ") || undefined}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (dragId && dragId !== row.id) setOverId(row.id);
                    }}
                    onDragLeave={() => setOverId((current) => (current === row.id ? null : current))}
                    onDrop={(event) => onDrop(event, row.id)}
                  >
                    <td className="order-cell">
                      <button
                        type="button"
                        className="secondary drag-handle"
                        draggable={!savingOrder}
                        aria-label={`Drag to reorder ${row.name}`}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", row.id);
                          event.dataTransfer.effectAllowed = "move";
                          setDragId(row.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverId(null);
                        }}
                      >
                        Drag
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        aria-label={`Move ${row.name} up`}
                        disabled={savingOrder || index === 0}
                        onClick={() => move(row.id, index - 1)}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        aria-label={`Move ${row.name} down`}
                        disabled={savingOrder || index === rows.length - 1}
                        onClick={() => move(row.id, index + 1)}
                      >
                        Down
                      </button>
                    </td>
                    <td>
                      <input
                        aria-label={`Name for ${row.name}`}
                        value={row.name}
                        onChange={(event) => updateRow(row.id, { name: event.target.value })}
                        onKeyDown={(event) => onRowKeyDown(event, row)}
                      />
                    </td>
                    <td>
                      <input
                        className="code-input"
                        aria-label={`Long code for ${row.name}`}
                        value={row.longCode ?? ""}
                        placeholder="CRD/NIC"
                        spellCheck={false}
                        onChange={(event) =>
                          updateRow(row.id, { longCode: event.target.value.toUpperCase() })
                        }
                        onKeyDown={(event) => onRowKeyDown(event, row)}
                      />
                    </td>
                    <td>
                      <input
                        className="code-input code-short"
                        aria-label={`Short code for ${row.name}`}
                        value={row.shortCode ?? ""}
                        placeholder="NIC"
                        maxLength={3}
                        spellCheck={false}
                        onChange={(event) =>
                          updateRow(row.id, {
                            shortCode: event.target.value.toUpperCase().slice(0, 3),
                          })
                        }
                        onKeyDown={(event) => onRowKeyDown(event, row)}
                      />
                    </td>
                    <td>
                      <Link className="button secondary" href={`/taxonomies/${row.id}`}>
                        Fields ({row.attributes.length})
                      </Link>
                    </td>
                    <td className="save-cell">
                      {dirty ? (
                        <button
                          type="button"
                          title="Save this row's name, long code, and short code. Reordering saves on its own."
                          disabled={savingId === row.id}
                          onClick={() => void saveRow(row)}
                        >
                          {savingId === row.id ? "Saving…" : "Save changes"}
                        </button>
                      ) : savedFlash === row.id ? (
                        <span className="saved-flash">Saved</span>
                      ) : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void askDelete(row)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {dialogOpen ? (
        <div className="dialog-backdrop" onMouseDown={creating ? undefined : () => setDialogOpen(false)}>
          <form
            className="dialog dialog-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-taxonomy-title"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void createRow();
            }}
          >
            <h2 id="new-taxonomy-title">New taxonomy</h2>
            <p className="hint">
              The long code and short code are stored in uppercase. Enter saves. Escape cancels.
            </p>
            <div className="grid">
              <label>
                Name
                <input
                  value={draftName}
                  autoFocus
                  autoComplete="off"
                  required
                  onChange={(event) => setDraftName(event.target.value)}
                />
              </label>
              <label>
                Long code
                <input
                  className="code-input"
                  value={draftLong}
                  placeholder="CRD/NIC"
                  spellCheck={false}
                  autoComplete="off"
                  required
                  onChange={(event) => setDraftLong(event.target.value.toUpperCase())}
                />
              </label>
              <label>
                Short code
                <input
                  className="code-input"
                  value={draftShort}
                  placeholder="NIC"
                  maxLength={3}
                  spellCheck={false}
                  autoComplete="off"
                  required
                  onChange={(event) => setDraftShort(event.target.value.toUpperCase().slice(0, 3))}
                />
              </label>
              <label>
                Start with fields from…
                <select value={sourceId} onChange={(event) => chooseSource(event.target.value)}>
                  <option value="">None</option>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                      {row.shortCode ? ` (${row.shortCode})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {source ? (
              source.attributes.length === 0 ? (
                <p className="muted">That taxonomy has no fields to link.</p>
              ) : (
                <ul className="picker-list">
                  {source.attributes.map((attribute) => (
                    <li key={attribute.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedFields.includes(attribute.id)}
                          onChange={() => toggleField(attribute.id)}
                        />
                        <span>
                          <strong>{attribute.name}</strong>
                          {attribute.label ? <span className="code-badge">{attribute.label}</span> : null}{" "}
                          <span className="hint">
                            {attribute.data_type}
                            {attribute.unit ? ` · ${attribute.unit}` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="hint">Leave this empty to create the taxonomy with no fields yet.</p>
            )}
            <div className="actions">
              <button type="button" className="secondary" disabled={creating} onClick={() => setDialogOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={creating}>
                {creating ? "Saving…" : "Save taxonomy"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete ${pendingDelete.name}?`}
          body={
            isDirty(pendingDelete, saved[pendingDelete.id])
              ? "No items use this taxonomy. Deleting it drops the unsaved name or code edits on this row and unlinks its fields. The field definitions stay."
              : "No items use this taxonomy. Deleting it unlinks its fields. The field definitions stay."
          }
          confirmLabel="Delete taxonomy"
          busy={deleting}
          onCancel={() => {
            if (!deleting) setPendingDelete(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </main>
  );
}
