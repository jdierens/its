"use client";

import { DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { GitMerge, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { valuesMatch, attributeValueError } from "@/components/AttributeValueField";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { usePageMeta } from "@/components/AppShell";
import { PageToolbar, ToolbarButton } from "@/components/PageToolbar";
import {
  addAttributeValue,
  createAttribute,
  deleteAttributeValue,
  deleteField,
  fetchAttributeUsage,
  fetchFieldCatalog,
  fetchTaxonomyAttributeUsage,
  linkAttributes,
  mergeFields,
  saveAttributeValueOrder,
  saveFieldOrder,
  setFieldRequired,
  unlinkAttribute,
  updateAttribute,
  type AttributeUsage,
  type FieldCatalogEntry,
} from "@/lib/attributes";
import { errorText } from "@/lib/errors";
import { isDirty } from "@/lib/formDirty";
import { fetchTaxonomy } from "@/lib/items";
import type { Attribute, DataType, ListedValue, Taxonomy } from "@/lib/types";

const DATA_TYPES: { id: DataType; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "integer", label: "Integer" },
  { id: "decimal", label: "Decimal" },
];

type PendingDelete =
  | { kind: "unlink"; id: string; name: string }
  | { kind: "definition"; id: string; name: string }
  | { kind: "value"; id: string; attributeId: string; label: string };

type FieldDefinition = {
  name: string;
  data_type: DataType;
  unit: string;
  label: string;
  uses_list: boolean;
};

function fieldDefinition(attribute: Attribute): FieldDefinition {
  return {
    name: attribute.name.trim(),
    data_type: attribute.data_type,
    unit: (attribute.unit ?? "").trim(),
    label: (attribute.label ?? "").trim(),
    uses_list: attribute.uses_list,
  };
}

function itemPhrase(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function valueUseCount(attribute: Attribute, listed: string, usage: AttributeUsage | undefined): number {
  if (!usage) return 0;
  return usage.values.filter((stored) => valuesMatch(attribute.data_type, listed, stored)).length;
}

function fieldSummary(field: FieldCatalogEntry): string {
  const unit = field.unit ? ` · ${field.unit}` : "";
  return `${field.dataType}${unit}`;
}

export function TaxonomyFields({ taxonomyId }: { taxonomyId: string }) {
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [catalog, setCatalog] = useState<FieldCatalogEntry[]>([]);
  const [usage, setUsage] = useState<Record<string, AttributeUsage>>({});
  const [localUse, setLocalUse] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<DataType>("text");
  const [draftUnit, setDraftUnit] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftUsesList, setDraftUsesList] = useState(true);
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<{ attributeId: string; valueId: string } | null>(null);
  const [fieldDragId, setFieldDragId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);
  const [sourceTaxonomyId, setSourceTaxonomyId] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeKeep, setMergeKeep] = useState("");
  const [mergeDrop, setMergeDrop] = useState("");
  const [savedFields, setSavedFields] = useState<Record<string, FieldDefinition>>({});
  const [toolbarSaved, setToolbarSaved] = useState(false);
  const savingRef = useRef(false);

  const reload = useCallback(async () => {
    const next = await fetchTaxonomy(taxonomyId);
    if (!next) {
      setTaxonomy(null);
      setMissing(true);
      return;
    }
    const ids = next.attributes.map((attribute) => attribute.id);
    const [nextUsage, nextLocal, nextCatalog] = await Promise.all([
      fetchAttributeUsage(ids),
      fetchTaxonomyAttributeUsage(taxonomyId, ids),
      fetchFieldCatalog(),
    ]);
    setTaxonomy(next);
    setSavedFields(
      Object.fromEntries(next.attributes.map((attribute) => [attribute.id, fieldDefinition(attribute)])),
    );
    setMissing(false);
    setUsage(nextUsage);
    setLocalUse(nextLocal);
    setCatalog(nextCatalog);
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
            { label: "Taxonomies & Fields", href: "/taxonomies" },
            { label: taxonomy.name },
          ],
        }
      : null,
  );

  useEffect(() => {
    if (!pickerOpen && !mergeOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || savingId === "link" || savingId === "merge") return;
      if (pickerOpen) setPickerOpen(false);
      if (mergeOpen) setMergeOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mergeOpen, pickerOpen, savingId]);

  function othersFor(attributeId: string): string[] {
    const entry = catalog.find((row) => row.id === attributeId);
    if (!entry) return [];
    return entry.taxonomies
      .filter((item) => item.id !== taxonomyId)
      .map((item) => item.name)
      .sort((a, b) => a.localeCompare(b));
  }

  function confirmShared(attribute: Attribute, change: string): boolean {
    const others = othersFor(attribute.id);
    if (others.length === 0) return true;
    return window.confirm(
      `${attribute.name} is shared with ${others.join(", ")}. ${change} changes it for every taxonomy that uses it.`,
    );
  }

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
    setToolbarSaved(false);
  }

  async function onCreate() {
    const name = draftName.trim();
    if (!name) {
      setError("Enter a name for the new field.");
      return;
    }
    const pendingEdits = taxonomy?.attributes.some((attribute) => {
      const saved = savedFields[attribute.id];
      return saved ? isDirty(fieldDefinition(attribute), saved) : false;
    });
    if (pendingEdits) {
      setError("Save field changes before adding another field.");
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
        label: draftLabel.trim() || null,
      });
      setDraftName("");
      setDraftUnit("");
      setDraftLabel("");
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

  const changedFields =
    taxonomy?.attributes.filter((attribute) => {
      const saved = savedFields[attribute.id];
      return !saved || isDirty(fieldDefinition(attribute), saved);
    }) ?? [];
  const draftDirty =
    draftName.trim() !== "" ||
    draftUnit.trim() !== "" ||
    draftLabel.trim() !== "" ||
    draftType !== "text" ||
    draftUsesList !== true;
  const fieldsDirty = changedFields.length > 0 || draftDirty;

  async function saveFields() {
    if (!taxonomy || savingRef.current) return;
    const pendingFields = changedFields;
    if (pendingFields.length === 0 && !draftDirty) return;
    for (const attribute of pendingFields) {
      const name = attribute.name.trim();
      if (!name) {
        setError("Field name is required.");
        return;
      }
      const used = usage[attribute.id]?.itemCount ?? 0;
      const original = savedFields[attribute.id];
      if (original && attribute.data_type !== original.data_type && used > 0) {
        setError(`${name} is used on ${itemPhrase(used)}, so its type stays ${original.data_type}.`);
        return;
      }
      if (original && attribute.data_type !== original.data_type) {
        const bad = attribute.values.find((row) => attributeValueError(attribute.data_type, row.value));
        if (bad) {
          setError(`Remove or change “${bad.value}” before switching this field to ${attribute.data_type}.`);
          return;
        }
      }
    }
    if (draftDirty && !draftName.trim()) {
      setError("Enter a name for the new field.");
      return;
    }
    for (const attribute of pendingFields) {
      if (!confirmShared(attribute, "Saving it")) return;
    }

    savingRef.current = true;
    setSavingId("toolbar");
    setError(null);
    setStatus(null);
    setToolbarSaved(false);
    try {
      for (const attribute of pendingFields) {
        await updateAttribute(attribute.id, {
          name: attribute.name.trim(),
          dataType: attribute.data_type,
          unit: attribute.unit?.trim() || null,
          usesList: attribute.uses_list,
          label: attribute.label?.trim() || null,
        });
      }
      const newName = draftName.trim();
      if (newName) {
        await createAttribute(taxonomyId, {
          name: newName,
          dataType: draftType,
          unit: draftUnit.trim() || null,
          usesList: draftUsesList,
          label: draftLabel.trim() || null,
        });
        setDraftName("");
        setDraftUnit("");
        setDraftLabel("");
        setDraftType("text");
        setDraftUsesList(true);
      }
      await reload();
      setToolbarSaved(true);
      setStatus(newName ? `Saved changes and added ${newName}.` : "Saved field changes.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      savingRef.current = false;
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
    if (!confirmShared(attribute, "Adding a list value")) return;
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
    if (!confirmShared(attribute, "Reordering list values")) return;
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
    event.stopPropagation();
    const payload = event.dataTransfer.getData("text/plain");
    const splitAt = payload.indexOf("|");
    const fromAttributeId = splitAt >= 0 ? payload.slice(0, splitAt) : "";
    const fromId = splitAt >= 0 ? payload.slice(splitAt + 1) : "";
    setDrag(null);
    if (!fromId || fromAttributeId !== attribute.id) return;
    const toIndex = attribute.values.findIndex((row) => row.id === toId);
    moveValue(attribute, fromId, toIndex);
  }

  async function persistFieldOrder(next: Attribute[]) {
    if (!taxonomy) return;
    const ordered = next.map((row, index) => ({ ...row, sortOrder: index + 1 }));
    setTaxonomy({ ...taxonomy, attributes: ordered });
    setSavingId("order");
    setError(null);
    try {
      await saveFieldOrder(taxonomyId, ordered.map((row) => row.id));
      setStatus("Field order saved.");
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

  function moveField(fromId: string, toIndex: number) {
    if (!taxonomy) return;
    const fromIndex = taxonomy.attributes.findIndex((row) => row.id === fromId);
    if (fromIndex < 0 || toIndex < 0 || toIndex >= taxonomy.attributes.length || fromIndex === toIndex) {
      return;
    }
    const next = taxonomy.attributes.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    void persistFieldOrder(next);
  }

  async function confirmDelete() {
    if (!pending || !taxonomy) return;
    setSavingId(pending.id);
    setError(null);
    setStatus(null);
    try {
      if (pending.kind === "unlink") {
        await unlinkAttribute(taxonomyId, pending.id);
        setStatus(`Removed ${pending.name} from ${taxonomy.name}.`);
      } else if (pending.kind === "definition") {
        const linkedHere = taxonomy.attributes.some((row) => row.id === pending.id);
        if (linkedHere) await unlinkAttribute(taxonomyId, pending.id);
        await deleteField(pending.id);
        setStatus(`Deleted ${pending.name}.`);
      } else {
        const attribute = taxonomy.attributes.find((row) => row.id === pending.attributeId);
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

  function linkableIds(ids: string[]): { ids: string[]; skipped: string[] } {
    if (!taxonomy) return { ids: [], skipped: [] };
    const takenIds = new Set(taxonomy.attributes.map((attribute) => attribute.id));
    const takenNames = new Set(taxonomy.attributes.map((attribute) => attribute.name.toLowerCase()));
    const chosen: string[] = [];
    const skipped: string[] = [];
    for (const id of ids) {
      const field = catalog.find((row) => row.id === id);
      if (!field || takenIds.has(field.id)) continue;
      if (takenNames.has(field.name.toLowerCase())) {
        skipped.push(field.name);
        continue;
      }
      takenNames.add(field.name.toLowerCase());
      chosen.push(field.id);
    }
    return { ids: chosen, skipped };
  }

  async function linkChosen(ids: string[]) {
    const next = linkableIds(ids);
    if (next.ids.length === 0) {
      setError(
        next.skipped.length > 0
          ? `Nothing new to link. This taxonomy already has ${next.skipped.join(", ")}.`
          : "Select at least one field that this taxonomy does not already use.",
      );
      return;
    }
    setSavingId("link");
    setError(null);
    setStatus(null);
    try {
      const added = await linkAttributes(taxonomyId, next.ids);
      await reload();
      setPickerOpen(false);
      setPickerSelected([]);
      const skipped =
        next.skipped.length > 0 ? ` Skipped ${next.skipped.join(", ")} because the name is already here.` : "";
      setStatus(`Linked ${added} ${added === 1 ? "field" : "fields"}.${skipped}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingId(null);
    }
  }

  async function onMerge() {
    const keep = catalog.find((row) => row.id === mergeKeep);
    const drop = catalog.find((row) => row.id === mergeDrop);
    if (!keep || !drop) {
      setError("Choose the field to keep and the field to merge into it.");
      return;
    }
    if (keep.dataType !== drop.dataType) {
      setError("Fields can only be merged when they have the same type.");
      return;
    }
    const keepLabel = keep.label ? ` (${keep.label})` : "";
    const dropLabel = drop.label ? ` (${drop.label})` : "";
    if (
      !window.confirm(
        `Merge ${drop.name}${dropLabel} into ${keep.name}${keepLabel}? Item values and taxonomy links move onto the field you keep, then the other definition is deleted.`,
      )
    ) {
      return;
    }
    setSavingId("merge");
    setError(null);
    setStatus(null);
    try {
      await mergeFields(keep.id, drop.id);
      setMergeOpen(false);
      setMergeKeep("");
      setMergeDrop("");
      await reload();
      setStatus(`Merged ${drop.name} into ${keep.name}.`);
    } catch (err) {
      setError(errorText(err));
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

  const query = pickerQuery.trim().toLowerCase();
  const pickerFields = catalog.filter((field) => {
    if (!query) return true;
    const haystack = [
      field.name,
      field.label ?? "",
      field.dataType,
      field.unit ?? "",
      ...field.taxonomies.map((item) => item.name),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
  const keepField = catalog.find((row) => row.id === mergeKeep) ?? null;
  const dropChoices = catalog.filter(
    (row) => row.id !== mergeKeep && (!keepField || row.dataType === keepField.dataType),
  );
  const sourceChoices = catalog
    .flatMap((field) => field.taxonomies)
    .filter((item, index, all) => item.id !== taxonomyId && all.findIndex((row) => row.id === item.id) === index)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="page">
      <PageToolbar
        dirty={fieldsDirty}
        saving={savingId === "toolbar"}
        saved={toolbarSaved}
        onSave={() => void saveFields()}
        disabled={savingId !== null && savingId !== "toolbar"}
        listen={!pickerOpen && !mergeOpen && !pending}
      >
        <ToolbarButton
          icon={Link2}
          label="Add existing field"
          disabled={savingId !== null}
          onClick={() => {
            setPickerQuery("");
            setPickerSelected([]);
            setSourceTaxonomyId("");
            setPickerOpen(true);
          }}
        />
        <ToolbarButton
          icon={GitMerge}
          label="Merge fields"
          disabled={savingId !== null}
          onClick={() => {
            setMergeKeep("");
            setMergeDrop("");
            setMergeOpen(true);
          }}
        />
      </PageToolbar>
      <p className="hint page-note">
        Add field creates a new field on this taxonomy only, even when another taxonomy already has
        the same name, type, unit, and label. Add existing field links a field that already exists,
        including its allowed values. A badge lists the other taxonomies that use the same field, and
        editing the name, unit, label, or value list changes it for all of them. Drag a field to set
        the order on this taxonomy. That order is what the item form and the items table use. Remove
        from this taxonomy unlinks it here. The definition can be deleted only when no taxonomy links
        it and no item still has a value.
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
            <select value={draftType} onChange={(event) => setDraftType(event.target.value as DataType)}>
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
          <label>
            Label
            <input
              value={draftLabel}
              placeholder="Optional"
              autoComplete="off"
              onChange={(event) => setDraftLabel(event.target.value)}
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
          <button
            type="submit"
            className="icon-button"
            disabled={savingId === "new"}
            aria-label={savingId === "new" ? "Adding" : "Add field"}
            title={savingId === "new" ? "Adding" : "Add field"}
          >
            {savingId === "new" ? (
              <Loader2 className="icon-spin" size={16} strokeWidth={1.75} aria-hidden />
            ) : (
              <Plus size={16} strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </div>
      </form>

      {taxonomy.attributes.length === 0 ? <p className="muted">No fields yet.</p> : null}

      {taxonomy.attributes.map((attribute, index) => {
        const used = usage[attribute.id]?.itemCount ?? 0;
        const local = localUse[attribute.id] ?? 0;
        const others = othersFor(attribute.id);
        const onlyHere = others.length === 0;
        const canDeleteDefinition = onlyHere && used === 0;
        return (
          <article
            className={`card field-card${fieldDragId === attribute.id ? " drop-target" : ""}`}
            key={attribute.id}
            onDragOver={(event) => {
              if (fieldDragId && fieldDragId !== attribute.id) event.preventDefault();
            }}
            onDrop={(event) => {
              if (!fieldDragId) return;
              event.preventDefault();
              const fromId = event.dataTransfer.getData("text/plain") || fieldDragId;
              setFieldDragId(null);
              if (!fromId || fromId.includes("|")) return;
              moveField(fromId, index);
            }}
          >
            <div className="field-meta">
              <div className="field-order">
                <button
                  type="button"
                  className="secondary drag-handle"
                  draggable={savingId !== "order"}
                  aria-label={`Drag to reorder ${attribute.name}`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", attribute.id);
                    event.dataTransfer.effectAllowed = "move";
                    setFieldDragId(attribute.id);
                  }}
                  onDragEnd={() => setFieldDragId(null)}
                >
                  Drag
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Move ${attribute.name} up`}
                  disabled={index === 0 || savingId === "order"}
                  onClick={() => moveField(attribute.id, index - 1)}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Move ${attribute.name} down`}
                  disabled={index === taxonomy.attributes.length - 1 || savingId === "order"}
                  onClick={() => moveField(attribute.id, index + 1)}
                >
                  Down
                </button>
              </div>
              {attribute.label ? <span className="code-badge">{attribute.label}</span> : null}
              {others.length > 0 ? (
                <span className="shared-badge">Shared with: {others.join(", ")}</span>
              ) : null}
            </div>
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
              <label>
                Label
                <input
                  aria-label={`Label for ${attribute.name}`}
                  value={attribute.label ?? ""}
                  placeholder="Optional"
                  autoComplete="off"
                  onChange={(event) => patchAttribute(attribute.id, { label: event.target.value })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={attribute.uses_list}
                  onChange={(event) => patchAttribute(attribute.id, { uses_list: event.target.checked })}
                />
                Allowed-value list
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={attribute.required}
                  onChange={(event) => {
                    const required = event.target.checked;
                    setTaxonomy((current) =>
                      current
                        ? {
                            ...current,
                            attributes: current.attributes.map((row) =>
                              row.id === attribute.id ? { ...row, required } : row,
                            ),
                          }
                        : current,
                    );
                    setFieldRequired(taxonomyId, attribute.id, required).catch((err: unknown) => {
                      setError(errorText(err));
                    });
                  }}
                />
                Required on this taxonomy
              </label>
            </div>
            <p className="hint">
              {local > 0
                ? `Used on ${itemPhrase(local)} in this taxonomy${used !== local ? ` (${itemPhrase(used)} in total)` : ""}. The type stays as it is.`
                : used > 0
                  ? `Not used on items in this taxonomy. ${itemPhrase(used)} elsewhere still use it, so the type stays as it is.`
                  : "Not used on any item."}{" "}
              {others.length > 0
                ? "Saving the name, unit, label, or list changes every taxonomy that shares this field."
                : canDeleteDefinition
                  ? "Delete field removes the definition and its value list."
                  : "Remove from this taxonomy unlinks it here and leaves the definition."}
            </p>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={local > 0 || savingId === attribute.id}
                title={
                  local > 0
                    ? `${itemPhrase(local)} in this taxonomy still have a value for it.`
                    : "Unlink this field from this taxonomy only."
                }
                onClick={() => setPending({ kind: "unlink", id: attribute.id, name: attribute.name })}
              >
                Remove from this taxonomy
              </button>
              <button
                type="button"
                className="danger"
                disabled={!canDeleteDefinition || savingId === attribute.id}
                title={
                  canDeleteDefinition
                    ? "Delete the field definition."
                    : used > 0
                      ? "Clear every item value before deleting the definition."
                      : "Unlink it from every taxonomy before deleting the definition."
                }
                onClick={() => setPending({ kind: "definition", id: attribute.id, name: attribute.name })}
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
                  {attribute.values.map((row, valueIndex) => {
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
                            event.stopPropagation();
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
                          disabled={valueIndex === 0 || savingId === attribute.id}
                          onClick={() => moveValue(attribute, row.id, valueIndex - 1)}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`Move ${row.value} down`}
                          disabled={valueIndex === attribute.values.length - 1 || savingId === attribute.id}
                          onClick={() => moveValue(attribute, row.id, valueIndex + 1)}
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
                          className="secondary icon-button"
                          disabled={count > 0 || savingId === attribute.id}
                          aria-label="Remove"
                          title="Remove"
                          onClick={() =>
                            setPending({
                              kind: "value",
                              id: row.id,
                              attributeId: attribute.id,
                              label: row.value,
                            })
                          }
                        >
                          <Trash2 size={16} strokeWidth={1.75} aria-hidden />
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
                    className="secondary icon-button"
                    disabled={savingId === attribute.id}
                    aria-label="Add value"
                    title="Add value"
                    onClick={() => void onAddValue(attribute)}
                  >
                    <Plus size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}

      {pickerOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={savingId === "link" ? undefined : () => setPickerOpen(false)}
        >
          <div
            className="dialog dialog-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-field-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="add-field-title">Add existing field</h2>
            <p className="hint">
              Linking adds the same definition to this taxonomy. It does not make a copy. Escape
              closes this.
            </p>
            <label>
              Search
              <input
                value={pickerQuery}
                autoFocus
                placeholder="Name, type, unit, or taxonomy"
                autoComplete="off"
                onChange={(event) => setPickerQuery(event.target.value)}
              />
            </label>
            <div className="picker-source">
              <label>
                Add all fields from
                <select value={sourceTaxonomyId} onChange={(event) => setSourceTaxonomyId(event.target.value)}>
                  <option value="">Choose a taxonomy</option>
                  {sourceChoices.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.shortCode ? ` (${item.shortCode})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="icon-button"
                disabled={!sourceTaxonomyId || savingId === "link"}
                aria-label="Add all"
                title="Add all"
                onClick={() =>
                  void linkChosen(
                    catalog
                      .filter((field) => field.taxonomies.some((item) => item.id === sourceTaxonomyId))
                      .map((field) => field.id),
                  )
                }
              >
                <Plus size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
            {pickerFields.length === 0 ? <p className="muted">No fields match.</p> : null}
            <ul className="picker-list">
              {pickerFields.map((field) => {
                const already = taxonomy.attributes.some((attribute) => attribute.id === field.id);
                const nameTaken = taxonomy.attributes.some(
                  (attribute) => attribute.name.toLowerCase() === field.name.toLowerCase(),
                );
                const disabled = already || nameTaken;
                return (
                  <li key={field.id}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={pickerSelected.includes(field.id)}
                        onChange={() =>
                          setPickerSelected((current) =>
                            current.includes(field.id)
                              ? current.filter((id) => id !== field.id)
                              : [...current, field.id],
                          )
                        }
                      />
                      <span>
                        <strong>{field.name}</strong>
                        {field.label ? <span className="code-badge">{field.label}</span> : null}{" "}
                        <span className="hint">{fieldSummary(field)}</span>
                        <span className="hint picker-used">
                          {field.taxonomies.length > 0
                            ? `Used by ${field.taxonomies.map((item) => item.name).join(", ")}`
                            : "Not linked to a taxonomy"}
                          {already ? " · Already on this taxonomy" : ""}
                          {!already && nameTaken ? " · This taxonomy already has this name" : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setPickerOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={savingId === "link" || pickerSelected.length === 0}
                onClick={() => void linkChosen(pickerSelected)}
              >
                {savingId === "link" ? "Linking…" : "Link selected"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mergeOpen ? (
        <div className="dialog-backdrop" onMouseDown={savingId === "merge" ? undefined : () => setMergeOpen(false)}>
          <form
            className="dialog dialog-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="merge-title"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void onMerge();
            }}
          >
            <h2 id="merge-title">Merge fields</h2>
            <p className="hint">
              The second field must have the same type. Its item values and taxonomy links move onto
              the field you keep. Merge stops when one item already has a value for both.
            </p>
            <label>
              Keep
              <select
                value={mergeKeep}
                onChange={(event) => {
                  setMergeKeep(event.target.value);
                  setMergeDrop("");
                }}
              >
                <option value="">Choose a field</option>
                {catalog.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                    {field.label ? ` · ${field.label}` : ""} ({field.dataType}
                    {field.unit ? `, ${field.unit}` : ""})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Merge into it
              <select value={mergeDrop} onChange={(event) => setMergeDrop(event.target.value)}>
                <option value="">Choose a field</option>
                {dropChoices.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                    {field.label ? ` · ${field.label}` : ""} ({field.dataType}
                    {field.unit ? `, ${field.unit}` : ""})
                  </option>
                ))}
              </select>
            </label>
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setMergeOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={savingId === "merge" || !mergeKeep || !mergeDrop}>
                {savingId === "merge" ? "Merging…" : "Merge"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {catalog.some((field) => field.taxonomies.length === 0) ? (
        <section className="card field-card">
          <h2>Definitions with no taxonomy</h2>
          <p className="hint">
            These fields are not linked anywhere. Delete is blocked while an item still has a value.
          </p>
          <ul className="picker-list">
            {catalog
              .filter((field) => field.taxonomies.length === 0)
              .map((field) => (
                <li key={field.id}>
                  <span>
                    <strong>{field.name}</strong>
                    {field.label ? <span className="code-badge">{field.label}</span> : null}{" "}
                    <span className="hint">{fieldSummary(field)}</span>
                  </span>
                  <button
                    type="button"
                    className="danger"
                    disabled={savingId === field.id}
                    onClick={() => setPending({ kind: "definition", id: field.id, name: field.name })}
                  >
                    Delete field
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {pending ? (
        <ConfirmDialog
          title={
            pending.kind === "unlink"
              ? `Remove ${pending.name} from ${taxonomy.name}?`
              : pending.kind === "definition"
                ? `Delete ${pending.name}?`
                : `Remove ${pending.label}?`
          }
          body={
            pending.kind === "unlink"
              ? "This unlinks the field from this taxonomy only. Other taxonomies keep it, and the definition stays."
              : pending.kind === "definition"
                ? "No taxonomy will still link this field, and no item has a value for it. Deleting it also removes its allowed values."
                : othersFor(pending.attributeId).length > 0
                  ? `This value is not used on any item. Removing it takes it off the shared list for ${othersFor(pending.attributeId).join(", ")} as well.`
                  : "This value is not used on any item. Removing it only takes it off the allowed list."
          }
          confirmLabel={
            pending.kind === "unlink"
              ? "Remove from this taxonomy"
              : pending.kind === "definition"
                ? "Delete field"
                : "Remove value"
          }
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
