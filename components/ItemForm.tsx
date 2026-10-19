"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AttributeValueField,
  attributeValueError,
  canonicalValue,
} from "@/components/AttributeValueField";
import { usePageMeta } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CountrySelect } from "@/components/CountrySelect";
import { ItemGallery, type PendingImage } from "@/components/ItemGallery";
import { ManufacturerSelect } from "@/components/ManufacturerSelect";
import { fetchCountries, type Country } from "@/lib/countries";
import { errorText } from "@/lib/errors";
import { uploadItemImages } from "@/lib/images";
import {
  DEFAULT_CONDITION,
  DEFAULT_ECCN,
  NEW_CONDITION_NOTES,
  conditionNoteAfterChange,
  htsError,
  type ItemCondition,
} from "@/lib/itemFields";
import { createItem, deleteItem, fetchItem, fetchTaxonomies, updateItem } from "@/lib/items";
import type { AttributeDefinition, DataType, Taxonomy } from "@/lib/types";

type ItemFormProps = {
  mode: "create" | "edit";
  itemId?: string;
};

type DraftAttribute = {
  key: string;
  name: string;
  data_type: DataType;
  unit: string;
  uses_list: boolean;
};

const DATA_TYPE_OPTIONS: DataType[] = ["integer", "decimal", "text"];

export function ItemForm({ mode, itemId }: ItemFormProps) {
  const router = useRouter();
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([]);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [taxonomyName, setTaxonomyName] = useState("");
  const [longCode, setLongCode] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [countries, setCountries] = useState<Country[]>([]);
  const [manufacturerId, setManufacturerId] = useState<string | null>(null);
  const [manufacturerName, setManufacturerName] = useState("");
  const [manufacturerUnresolved, setManufacturerUnresolved] = useState(false);
  const [model, setModel] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [condition, setCondition] = useState<ItemCondition>(DEFAULT_CONDITION);
  const [conditionNote, setConditionNote] = useState("");
  const [eccn, setEccn] = useState(DEFAULT_ECCN);
  const [usHts, setUsHts] = useState("");
  const [ccats, setCcats] = useState("");
  const [coo, setCoo] = useState("");
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>({});
  const [loadedAttributes, setLoadedAttributes] = useState<Record<string, string>>({});
  const [loadedTaxonomyName, setLoadedTaxonomyName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftAttribute[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<DataType>("text");
  const [draftUnit, setDraftUnit] = useState("");
  const [draftUsesList, setDraftUsesList] = useState(true);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  usePageMeta({
    title: mode === "create" ? "New item" : name.trim() || "Edit item",
    crumbs: [
      { label: "Inventory" },
      { label: "Items", href: "/items" },
      { label: mode === "create" ? "New item" : name.trim() || "Edit item" },
    ],
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [taxonomyRows, countryRows, item] = await Promise.all([
          fetchTaxonomies(),
          fetchCountries(),
          mode === "edit" && itemId ? fetchItem(itemId) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setTaxonomies(taxonomyRows);
        setCountries(countryRows);
        if (mode === "edit") {
          if (!item) {
            setMissing(true);
            return;
          }
          const taxonomy = taxonomyRows.find((row) => row.id === item.taxonomyId) ?? null;
          const values: Record<string, string> = {};
          for (const [attributeName, value] of Object.entries(item.attributes)) {
            const attribute = taxonomy?.attributes.find(
              (row) => row.name.toLowerCase() === attributeName.toLowerCase(),
            );
            values[attribute?.name ?? attributeName] = attribute
              ? canonicalValue(attribute, value)
              : value;
          }
          setSku(item.sku);
          setName(item.name);
          setDescription(item.description);
          setQuantity(item.quantity === null ? "" : String(item.quantity));
          setTaxonomyName(taxonomy?.name ?? "");
          setLoadedTaxonomyName(taxonomy?.name ?? null);
          setLoadedAttributes(values);
          setAttributeValues(values);
          setManufacturerId(item.manufacturerId);
          setManufacturerName(item.manufacturerName);
          setModel(item.model);
          setPartNumber(item.partNumber);
          setCondition(item.condition);
          setConditionNote(item.conditionNote);
          setEccn(item.eccn || DEFAULT_ECCN);
          setUsHts(item.usHts);
          setCcats(item.ccats);
          setCoo(item.coo);
        }
      } catch (error) {
        if (!cancelled) setLoadError(errorText(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [mode, itemId]);

  const taxonomy = useMemo(() => {
    const query = taxonomyName.trim().toLowerCase();
    if (!query) return null;
    return taxonomies.find((row) => row.name.toLowerCase() === query) ?? null;
  }, [taxonomies, taxonomyName]);

  const isNewTaxonomy = taxonomyName.trim() !== "" && !taxonomy;

  function onTaxonomyChange(nextName: string) {
    setTaxonomyName(nextName);
    setSaved(false);
    setDrafts([]);
    const match = taxonomies.find(
      (row) => row.name.toLowerCase() === nextName.trim().toLowerCase(),
    );
    if (match && loadedTaxonomyName && match.name.toLowerCase() === loadedTaxonomyName.toLowerCase()) {
      setAttributeValues(loadedAttributes);
      return;
    }
    setAttributeValues({});
  }

  function addDraft() {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setSaveError("Enter a name for the new attribute.");
      return;
    }
    const existing = [
      ...(taxonomy?.attributes.map((attribute) => attribute.name) ?? []),
      ...drafts.map((draft) => draft.name),
    ];
    if (existing.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) {
      setSaveError(`Attribute ${trimmed} already exists on this taxonomy.`);
      return;
    }
    setSaveError(null);
    setDrafts((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        name: trimmed,
        data_type: draftType,
        unit: draftUnit.trim(),
        uses_list: draftUsesList,
      },
    ]);
    setDraftName("");
    setDraftUnit("");
    setDraftType("text");
    setDraftUsesList(true);
    setSaved(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);

    const trimmedName = name.trim();
    const trimmedSku = sku.trim();
    const trimmedTaxonomy = taxonomy?.name ?? taxonomyName.trim();
    if (!trimmedName) {
      setSaveError("Name is required.");
      return;
    }
    if (!trimmedSku) {
      setSaveError("SKU is required.");
      return;
    }
    if (mode === "create" && !trimmedTaxonomy) {
      setSaveError("Choose a taxonomy.");
      return;
    }
    if (manufacturerUnresolved) {
      setSaveError("Choose a manufacturer from the list, or add the new name.");
      return;
    }
    const htsProblem = htsError(usHts);
    if (htsProblem) {
      setSaveError(`US HTS: ${htsProblem}`);
      return;
    }

    const creatingTaxonomy = trimmedTaxonomy !== "" && !taxonomy;
    let longCodeValue: string | null = null;
    let shortCodeValue: string | null = null;
    if (creatingTaxonomy) {
      longCodeValue = longCode.trim().toUpperCase();
      shortCodeValue = shortCode.trim().toUpperCase();
      if (!/^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(longCodeValue)) {
        setSaveError("Long code must be uppercase letters, digits, and slashes, like CRD/NIC.");
        return;
      }
      if (!/^[A-Z0-9]{3}$/.test(shortCodeValue)) {
        setSaveError("Short code must be exactly 3 letters or digits.");
        return;
      }
    }

    const quantityText = quantity.trim();
    const parsedQuantity = quantityText === "" ? null : Number(quantityText);
    if (parsedQuantity !== null && (!Number.isFinite(parsedQuantity) || !Number.isInteger(parsedQuantity))) {
      setSaveError("Quantity must be a whole number.");
      return;
    }

    const attributes: Record<string, string> = {};
    for (const attribute of taxonomy?.attributes ?? []) {
      const value = (attributeValues[attribute.name] ?? "").trim();
      if (!value) continue;
      const problem = attributeValueError(attribute.data_type, value);
      if (problem) {
        setSaveError(`${attribute.name}: ${problem}`);
        return;
      }
      attributes[attribute.name] = value;
    }

    const attributeDefs: AttributeDefinition[] = [];
    for (const draft of drafts) {
      const value = (attributeValues[draft.key] ?? "").trim();
      if (value) {
        const problem = attributeValueError(draft.data_type, value);
        if (problem) {
          setSaveError(`${draft.name}: ${problem}`);
          return;
        }
        attributes[draft.name] = value;
      }
      attributeDefs.push({
        name: draft.name,
        data_type: draft.data_type,
        unit: draft.unit || null,
        uses_list: draft.uses_list,
      });
    }

    const input = {
      name: trimmedName,
      sku: trimmedSku,
      description: description.trim(),
      quantity: parsedQuantity,
      taxonomyName: trimmedTaxonomy || null,
      attributes,
      attributeDefs,
      longCode: longCodeValue,
      shortCode: shortCodeValue,
      manufacturerId,
      model,
      partNumber,
      condition,
      conditionNote,
      eccn,
      usHts,
      ccats,
      coo,
    };

    setSaving(true);
    try {
      if (mode === "create") {
        const id = createdId ?? (await createItem(input));
        setCreatedId(id);
        if (pendingImages.length > 0) {
          await uploadItemImages(
            id,
            pendingImages.map((image) => ({ file: image.file, isPrimary: image.isPrimary })),
          );
        }
        router.push(`/items/${id}`);
        return;
      }
      if (!itemId) throw new Error("Missing item id.");
      await updateItem(itemId, input);
      const refreshed = await fetchTaxonomies();
      setTaxonomies(refreshed);
      const match = refreshed.find((row) => row.name.toLowerCase() === trimmedTaxonomy.toLowerCase());
      setTaxonomyName(match?.name ?? trimmedTaxonomy);
      setLoadedTaxonomyName(match?.name ?? (trimmedTaxonomy || null));
      setLoadedAttributes(attributes);
      setAttributeValues(attributes);
      setDrafts([]);
      setSaved(true);
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!itemId) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await deleteItem(itemId);
      router.push("/items");
    } catch (error) {
      setSaveError(errorText(error));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="page">
        <p className="banner error">{loadError}</p>
        <Link href="/items">Back to items</Link>
      </main>
    );
  }

  if (missing) {
    return (
      <main className="page">
        <p>Item not found.</p>
        <p className="muted">That item is not in the inventory.</p>
        <Link href="/items">Back to items</Link>
      </main>
    );
  }

  const labelHref = sku.trim()
    ? `/labels?sku=${encodeURIComponent(sku.trim())}`
    : itemId
      ? `/labels?id=${itemId}`
      : "/labels";

  return (
    <main className="page">
      {mode === "edit" && itemId ? (
        <div className="page-head">
          <Link className="button secondary" href={labelHref}>
            Print label
          </Link>
        </div>
      ) : null}
      {saveError ? (
        <p className="banner error" role="alert">
          {saveError}
        </p>
      ) : null}
      {saved ? (
        <p className="banner ok" role="status">
          Saved.
        </p>
      ) : null}
      {createdId && saveError ? (
        <p className="muted">
          The item was saved. <Link href={`/items/${createdId}`}>Open it</Link> to finish the photos.
        </p>
      ) : null}
      <form onSubmit={onSubmit} noValidate>
        <div className="grid">
          <label>
            SKU
            <input
              value={sku}
              onChange={(event) => {
                setSku(event.target.value);
                setSaved(false);
              }}
              autoComplete="off"
              required
            />
          </label>
          <label>
            Quantity
            <input
              type="number"
              step="1"
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
                setSaved(false);
              }}
            />
          </label>
        </div>
        <label>
          Name
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            autoComplete="off"
            required
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label>
          Taxonomy
          <input
            list="taxonomy-names"
            value={taxonomyName}
            placeholder="Select or type a taxonomy"
            autoComplete="off"
            onChange={(event) => onTaxonomyChange(event.target.value)}
          />
          <datalist id="taxonomy-names">
            {taxonomies.map((row) => (
              <option key={row.id} value={row.name} />
            ))}
          </datalist>
          {isNewTaxonomy ? (
            <span className="hint">
              New taxonomy. Enter its codes, then save. It is added at the end of the list.
            </span>
          ) : null}
        </label>
        {isNewTaxonomy ? (
          <div className="grid">
            <label>
              Long code
              <input
                value={longCode}
                placeholder="CRD/NIC"
                autoComplete="off"
                spellCheck={false}
                required
                onChange={(event) => {
                  setLongCode(event.target.value.toUpperCase());
                  setSaved(false);
                }}
              />
            </label>
            <label>
              Short code
              <input
                value={shortCode}
                placeholder="NIC"
                maxLength={3}
                autoComplete="off"
                spellCheck={false}
                required
                onChange={(event) => {
                  setShortCode(event.target.value.toUpperCase().slice(0, 3));
                  setSaved(false);
                }}
              />
              <span className="hint">Exactly 3 letters or digits. Printed on the label.</span>
            </label>
          </div>
        ) : null}
        <fieldset>
          <legend>Main</legend>
          <div className="grid">
            <ManufacturerSelect
              manufacturerId={manufacturerId}
              manufacturerName={manufacturerName}
              onChange={(id, nextName) => {
                setManufacturerId(id);
                setManufacturerName(nextName);
                setSaved(false);
              }}
              onUnresolved={setManufacturerUnresolved}
            />
            <label>
              Model
              <input
                value={model}
                autoComplete="off"
                onChange={(event) => {
                  setModel(event.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <label>
              Part number
              <input
                value={partNumber}
                autoComplete="off"
                onChange={(event) => {
                  setPartNumber(event.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <label>
              Condition
              <select
                value={condition}
                onChange={(event) => {
                  const next = event.target.value === "New" ? "New" : "Used";
                  setCondition(next);
                  setConditionNote((note) => conditionNoteAfterChange(next, note));
                  setSaved(false);
                }}
              >
                <option value="Used">Used</option>
                <option value="New">New</option>
              </select>
            </label>
            {condition === "New" ? (
              <label>
                Condition note
                <select
                  value={
                    NEW_CONDITION_NOTES.includes(conditionNote as (typeof NEW_CONDITION_NOTES)[number])
                      ? conditionNote
                      : ""
                  }
                  onChange={(event) => {
                    setConditionNote(event.target.value);
                    setSaved(false);
                  }}
                >
                  <option value="">None</option>
                  {NEW_CONDITION_NOTES.map((note) => (
                    <option key={note} value={note}>
                      {note}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Condition note
                <input
                  value={conditionNote}
                  autoComplete="off"
                  onChange={(event) => {
                    setConditionNote(event.target.value);
                    setSaved(false);
                  }}
                />
                <span className="hint">Optional.</span>
              </label>
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend>Trade compliance</legend>
          <div className="grid">
            <label>
              ECCN
              <input
                value={eccn}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setEccn(event.target.value);
                  setSaved(false);
                }}
              />
              <span className="hint">Blank saves as {DEFAULT_ECCN}.</span>
            </label>
            <label>
              US HTS
              <input
                value={usHts}
                autoComplete="off"
                spellCheck={false}
                placeholder="8471.30.0100"
                onChange={(event) => {
                  setUsHts(event.target.value);
                  setSaved(false);
                }}
              />
              <span className="hint">Digits and optional dots, up to 10 digits.</span>
            </label>
            <label>
              CCATS
              <input
                value={ccats}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setCcats(event.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <CountrySelect
              countries={countries}
              value={coo}
              onChange={(alpha3) => {
                setCoo(alpha3);
                setSaved(false);
              }}
            />
          </div>
        </fieldset>
        {taxonomyName.trim() ? (
          <fieldset>
            <legend>{taxonomy?.name ?? taxonomyName.trim()} attributes</legend>
            <div className="grid">
              {(taxonomy?.attributes ?? []).map((attribute) => (
                <AttributeValueField
                  key={attribute.id}
                  attribute={attribute}
                  value={attributeValues[attribute.name] ?? ""}
                  onChange={(value) => {
                    setAttributeValues((current) => ({ ...current, [attribute.name]: value }));
                    setSaved(false);
                  }}
                />
              ))}
              {drafts.map((draft) => (
                <AttributeValueField
                  key={draft.key}
                  attribute={{
                    id: draft.key,
                    name: draft.name,
                    label: null,
                    data_type: draft.data_type,
                    unit: draft.unit || null,
                    uses_list: draft.uses_list,
                    sortOrder: 0,
                    allowedValues: [],
                    values: [],
                  }}
                  value={attributeValues[draft.key] ?? ""}
                  onChange={(value) => {
                    setAttributeValues((current) => ({ ...current, [draft.key]: value }));
                    setSaved(false);
                  }}
                />
              ))}
            </div>
            <div className="draft-attribute">
              <label>
                New attribute
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
                  {DATA_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Unit
                <input
                  value={draftUnit}
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
                Allowed values
              </label>
              <button type="button" className="secondary" onClick={addDraft}>
                Add attribute
              </button>
            </div>
          </fieldset>
        ) : null}
        <ItemGallery
          itemId={mode === "edit" ? itemId : undefined}
          pending={pendingImages}
          onPendingChange={setPendingImages}
        />
        <div className="actions">
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create item" : "Save changes"}
          </button>
        </div>
      </form>
      {mode === "edit" && itemId ? (
        <section className="danger-zone">
          <h2>Delete item</h2>
          <p>
            Removes this item, its attribute values, and its photos. The photo files are deleted
            from storage as well.
          </p>
          <button type="button" className="danger" onClick={() => setConfirmDelete(true)} disabled={deleting}>
            Delete item
          </button>
        </section>
      ) : null}
      {confirmDelete ? (
        <ConfirmDialog
          title="Delete this item?"
          body="Its attribute values and photos are removed, including the files in storage. This cannot be undone."
          confirmLabel="Delete item"
          busy={deleting}
          onCancel={() => {
            if (!deleting) setConfirmDelete(false);
          }}
          onConfirm={() => void onDelete()}
        />
      ) : null}
    </main>
  );
}
