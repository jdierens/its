"use client";

import { DragEvent, useCallback, useEffect, useState } from "react";
import { valuesMatch, attributeValueError } from "@/components/AttributeValueField";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { usePageMeta } from "@/components/AppShell";
import {
  addAttributeValue,
  createAttribute,
  deleteAttribute,
  deleteAttributeValue,
  fetchAttributeUsage,
  saveAttributeValueOrder,
  updateAttribute,
  type AttributeUsage,
} from "@/lib/attributes";
import { errorText } from "@/lib/errors";
import { fetchTaxonomy } from "@/lib/items";
import type { Attribute, DataType, ListedValue, Taxonomy } from "@/lib/types";

const DATA_TYPES: { id: DataType; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "integer", label: "Integer" },
  { id: "decimal", label: "Decimal" },
];

type PendingDelete =
  | { kind: "attribute"; id: string; name: string }
  | { kind: "value"; id: string; attributeId: string; label: string };

function itemPhrase(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function valueUseCount(attribute: Attribute, listed: string, usage: AttributeUsage | undefined): number {
  if (!usage) return 0;
  return usage.values.filter((stored) => valuesMatch(attribute.data_type, listed, stored)).length;
}

export function TaxonomyFields({ taxonomyId }: { taxonomyId: string }) {
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [usage, setUsage] = useState<Record<string, AttributeUsage>>({});
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<DataType>("text");
  const [draftUnit, setDraftUnit] = useState("");
  const [draftUsesList, setDraftUsesList] = useState(true);
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<{ attributeId: string; valueId: string } | null>(null);

  const reload = useCallback(async () => {
    const next = await fetchTaxonomy(taxonomyId);
    if (!next) {
      setTaxonomy(null);
      setMissing(true);
      return;
    }
    setTaxonomy(next);
    setMissing(false);
    setUsage(await fetchAttributeUsage(next.attributes.map((attribute) => attribute.id)));
  }, [taxonomyId]);

  useEffect(() => {
    let cancelled = false;
    reload()
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  usePageMeta(
    taxonomy
      ? {
          title: taxonomy.name,
          crumbs: [
            { label: "Inventory" },
            { label: "Taxonomies & fields", href: "/taxonomies" },
            { label: taxonomy.name },
          ],
        }
      : null,
  );

  function patchAttribute(id: string, patch: Partial<Attribute>) {
    setTaxonomy((current) =>
      current
        ? {
            ...current,
            attributes: current.attributes.map((attribute) =>
              attribute.id === id ? { ...attribute, ...patch } : attribute,
            ),
          }
        : current,
    );
    setStatus(null);
  }

  async function onCreate() {
    const name = draftName.trim();
    if (!name) {
      setError("Enter a name for the new field.");
      return;
    }
    setSavingId("new");
    setError(null);
    setStatus(null);
    try {
      await createAttribute(taxonomyId, {
        name,
        dataType: draftType,
        unit: draftUnit.trim() || null,
        usesList: draftUsesList,
      });
      setDraftName("");
      setDraftUnit("");
      setDraftType("text");
      setDraftUsesList(true);
      await reload();
      setStatus(`Added ${name}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingId(null);
    }
  }

  async function onSave(attribute: Attribute) {
    const name = attribute.name.trim();
    if (!name) {
      setError("Field name is required.");
      return;
    }
    const used = usage[attribute.id]?.itemCount ?? 0;
    const original = taxonomy?.attributes.find((row) => row.id === attribute.id);
    if (original && attribute.data_type !== original.data_type && used > 0) {
      setError(
        `${name} is used on ${itemPhrase(used)}, so its type stays ${original.data_type}.`,
      );
      return;
    }
    if (original && attribute.data_type !== original.data_type) {
      const bad = original.values.find((row) => attributeValueError(attribute.data_type, row.value));
      if (bad) {
        setError(`Remove or change “${bad.value}” before switching this field to ${attribute.data_type}.`);
        return;
      }
    }

    setSavingId(attribute.id);
    setError(null);
    setStatus(null);
    try {
      await updateAttribute(attribute.id, {
        name,
        dataType: attribute.data_type,
        unit: attribute.unit?.trim() || null,
        usesList: attribute.uses_list,
      });
      await reload();
      setStatus(`Saved ${name}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingId(null);
    }
  }

  async function onAddValue(attribute: Attribute) {
    const value = (newValues[attribute.id] ?? "").trim();
    if (!value) {
      setError("Enter a value to add.");
      return;
    }
    const problem = attributeValueError(attribute.data_type, value);
    if (problem) {
      setError(problem);
      return;
    }
    setSavingId(attribute.id);
    setError(null);
    setStatus(null);
    try {
      await addAttributeValue(attribute.id, value);
      setNewValues((current) => ({ ...current, [attribute.id]: "" }));
      await reload();
      setStatus(`Added ${value}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingId(null);
    }
  }

  async function persistValues(attribute: Attribute, next: ListedValue[]) {
    const ordered = next.map((row, index) => ({ ...row, sortOrder: index + 1 }));
    patchAttribute(attribute.id, {
      values: ordered,
      allowedValues: ordered.map((row) => row.value),
    });
    setSavingId(attribute.id);
    setError(null);
    try {
      await saveAttributeValueOrder(ordered.map((row) => row.id));
      setStatus("Value order saved.");
    } catch (err) {
      setError(errorText(err));
      try {
        await reload();
      } catch (reloadError) {
        setError(errorText(reloadError));
      }
    } finally {
      setSavingId(null);
    }
  }

  function moveValue(attribute: Attribute, fromId: string, toIndex: number) {
    const fromIndex = attribute.values.findIndex((row) => row.id === fromId);
    if (fromIndex < 0 || toIndex < 0 || toIndex >= attribute.values.length || fromIndex === toIndex) {
      return;
    }
    const next = attribute.values.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    void persistValues(attribute, next);
  }

  function onDropValue(event: DragEvent<HTMLLIElement>, attribute: Attribute, toId: string) {
    event.preventDefault();
    const payload = event.dataTransfer.getData("text/plain");
    const splitAt = payload.indexOf("|");
    const fromAttributeId = splitAt >= 0 ? payload.slice(0, splitAt) : "";
    const fromId = splitAt >= 0 ? payload.slice(splitAt + 1) : "";
    setDrag(null);
    if (!fromId || fromAttributeId !== attribute.id) return;
    const toIndex = attribute.values.findIndex((row) => row.id === toId);
    moveValue(attribute, fromId, toIndex);
  }

  async function confirmDelete() {
    if (!pending) return;
    setSavingId(pending.id);
    setError(null);
    setStatus(null);
    try {
      if (pending.kind === "attribute") {
        await deleteAttribute(pending.id);
        setStatus(`Deleted ${pending.name}.`);
      } else {
        const attribute = taxonomy?.attributes.find((row) => row.id === pending.attributeId);
        const listed = attribute?.values.find((row) => row.id === pending.id);
        const count = attribute && listed ? valueUseCount(attribute, listed.value, usage[attribute.id]) : 0;
        if (count > 0) {
          throw new Error(
            `“${pending.label}” is used on ${itemPhrase(count)}. Change those items before removing it.`,
          );
        }
        await deleteAttributeValue(pending.id);
        setStatus(`Removed ${pending.label}.`);
      }
      setPending(null);
      await reload();
    } catch (err) {
      setError(errorText(err));
      setPending(null);
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Loading fields…</p>
      </main>
    );
  }

  if (missing || !taxonomy) {
    return (
      <main className="page">
        <p className="banner error">{error ?? "That taxonomy is not in the list."}</p>
      </main>
    );
  }

  return (
    <main className="page">
      <p className="hint page-note">
        Fields describe items of this taxonomy. Renaming a field keeps the values already stored on
        items. A field or list value that items use cannot be deleted until those items no longer
        use it. Deleting an unused field also deletes its value list.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {status ? <p className="banner ok">{status}</p> : null}

      <form
        className="field-create"
        onSubmit={(event) => {
          event.preventDefault();
          void onCreate();
        }}
      >
        <div className="grid field-grid">
          <label>
            New field
            <input
              value={draftName}
              autoComplete="off"
              onChange={(event) => setDraftName(event.target.value)}
            />
          </label>
          <label>
            Type
            <select
              value={draftType}
              onChange={(event) => setDraftType(event.target.value as DataType)}
            >
              {DATA_TYPES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Unit
            <input
              value={draftUnit}
              placeholder="Optional"
              autoComplete="off"
              onChange={(event) => setDraftUnit(event.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draftUsesList}
              onChange={(event) => setDraftUsesList(event.target.checked)}
            />
            Allowed-value list
          </label>
        </div>
        <div className="actions">
          <button type="submit" disabled={savingId === "new"}>
            {savingId === "new" ? "Adding…" : "Add field"}
          </button>
        </div>
      </form>

      {taxonomy.attributes.length === 0 ? <p className="muted">No fields yet.</p> : null}

      {taxonomy.attributes.map((attribute) => {
        const used = usage[attribute.id]?.itemCount ?? 0;
        return (
          <article className="card field-card" key={attribute.id}>
            <div className="grid field-grid">
              <label>
                Name
                <input
                  aria-label={`Name for ${attribute.name}`}
                  value={attribute.name}
                  autoComplete="off"
                  onChange={(event) => patchAttribute(attribute.id, { name: event.target.value })}
                />
              </label>
              <label>
                Type
                <select
                  aria-label={`Type for ${attribute.name}`}
                  value={attribute.data_type}
                  disabled={used > 0}
                  onChange={(event) =>
                    patchAttribute(attribute.id, { data_type: event.target.value as DataType })
                  }
                >
                  {DATA_TYPES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Unit
                <input
                  aria-label={`Unit for ${attribute.name}`}
                  value={attribute.unit ?? ""}
                  placeholder="Optional"
                  autoComplete="off"
                  onChange={(event) => patchAttribute(attribute.id, { unit: event.target.value })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={attribute.uses_list}
                  onChange={(event) =>
                    patchAttribute(attribute.id, { uses_list: event.target.checked })
                  }
                />
                Allowed-value list
              </label>
            </div>
            <p className="hint">
              {used > 0
                ? `Used on ${itemPhrase(used)}. The type stays as it is, and the field cannot be deleted until those items no longer use it. Renaming updates the name everywhere.`
                : "Not used on any item. Deleting it removes the field and its value list."}
            </p>
            <div className="actions">
              <button type="button" disabled={savingId === attribute.id} onClick={() => void onSave(attribute)}>
                {savingId === attribute.id ? "Saving…" : "Save field"}
              </button>
              <button
                type="button"
                className="danger"
                disabled={used > 0 || savingId === attribute.id}
                onClick={() => setPending({ kind: "attribute", id: attribute.id, name: attribute.name })}
              >
                Delete field
              </button>
            </div>

            {attribute.uses_list || attribute.values.length > 0 ? (
              <div className="value-list">
                <h2>Allowed values</h2>
                {!attribute.uses_list ? (
                  <p className="hint">
                    The list is off, so items are not limited to these values. They stay saved until
                    you remove them.
                  </p>
                ) : null}
                {attribute.values.length === 0 ? <p className="muted">No values yet.</p> : null}
                <ul>
                  {attribute.values.map((row, index) => {
                    const count = valueUseCount(attribute, row.value, usage[attribute.id]);
                    return (
                      <li
                        key={row.id}
                        className={drag?.valueId === row.id ? "drop-target" : undefined}
                        onDragOver={(event) => {
                          if (drag?.attributeId === attribute.id) event.preventDefault();
                        }}
                        onDrop={(event) => onDropValue(event, attribute, row.id)}
                      >
                        <button
                          type="button"
                          className="secondary"
                          draggable
                          aria-label={`Drag to reorder ${row.value}`}
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/plain", `${attribute.id}|${row.id}`);
                            event.dataTransfer.effectAllowed = "move";
                            setDrag({ attributeId: attribute.id, valueId: row.id });
                          }}
                          onDragEnd={() => setDrag(null)}
                        >
                          Drag
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`Move ${row.value} up`}
                          disabled={index === 0 || savingId === attribute.id}
                          onClick={() => moveValue(attribute, row.id, index - 1)}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`Move ${row.value} down`}
                          disabled={index === attribute.values.length - 1 || savingId === attribute.id}
                          onClick={() => moveValue(attribute, row.id, index + 1)}
                        >
                          Down
                        </button>
                        <span className="value-text">{row.value}</span>
                        {count > 0 ? (
                          <span className="hint value-use">Used on {itemPhrase(count)}</span>
                        ) : (
                          <span className="hint value-use">Not used</span>
                        )}
                        <button
                          type="button"
                          className="secondary"
                          disabled={count > 0 || savingId === attribute.id}
                          onClick={() =>
                            setPending({
                              kind: "value",
                              id: row.id,
                              attributeId: attribute.id,
                              label: row.value,
                            })
                          }
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="value-add">
                  <input
                    aria-label={`New value for ${attribute.name}`}
                    value={newValues[attribute.id] ?? ""}
                    placeholder="New value"
                    autoComplete="off"
                    onChange={(event) =>
                      setNewValues((current) => ({ ...current, [attribute.id]: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void onAddValue(attribute);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="secondary"
                    disabled={savingId === attribute.id}
                    onClick={() => void onAddValue(attribute)}
                  >
                    Add value
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}

      {pending ? (
        <ConfirmDialog
          title={pending.kind === "attribute" ? `Delete ${pending.name}?` : `Remove ${pending.label}?`}
          body={
            pending.kind === "attribute"
              ? "This field is not used on any item. Deleting it also removes its allowed values."
              : "This value is not used on any item. Removing it only takes it off the allowed list."
          }
          confirmLabel={pending.kind === "attribute" ? "Delete field" : "Remove value"}
          busy={savingId === pending.id}
          onCancel={() => {
            if (savingId !== pending.id) setPending(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </main>
  );
}
