"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ScanBarcode, Shapes, Trash2 } from "lucide-react";
import {
  AttributeValueField,
  attributeValueError,
  canonicalValue,
} from "@/components/AttributeValueField";
import { usePageMeta } from "@/components/AppShell";
import { ChangeTaxonomyDialog } from "@/components/ChangeTaxonomyDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CountrySelect } from "@/components/CountrySelect";
import { ItemGallery, type PendingImage } from "@/components/ItemGallery";
import { ManufacturerSelect } from "@/components/ManufacturerSelect";
import { PageToolbar, ToolbarButton, ToolbarSeparator } from "@/components/PageToolbar";
import { fetchCountries, type Country } from "@/lib/countries";
import { errorText } from "@/lib/errors";
import { isDirty, SAVE_BEFORE_LABEL, SAVE_BEFORE_TAXONOMY } from "@/lib/formDirty";
import { uploadItemImages } from "@/lib/imageUpload";
import {
  DEFAULT_CONDITION,
  DEFAULT_ECCN,
  NEW_CONDITION_NOTES,
  conditionNoteAfterChange,
  DEFAULT_ITEM_TYPE,
  DEFAULT_UNIT,
  ITEM_TYPES,
  SEEDED_UNITS,
  htsError,
  unitOrDefault,
  type ItemCondition,
  type ItemType,
} from "@/lib/itemFields";
import { changeItemTaxonomy, createItem, deleteItem, fetchItem, fetchTaxonomies, saveItemNotes, updateItem } from "@/lib/items";
import { productUrlError, productUrlHref } from "@/lib/productUrl";
import { previewNewItemSku, skuSubmittedForCreate } from "@/lib/sku";
import { fetchUnits } from "@/lib/units";
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

type ItemSnapshot = {
  sku: string;
  name: string;
  description: string;
  quantity: string;
  taxonomyName: string;
  longCode: string;
  shortCode: string;
  manufacturerId: string | null;
  manufacturerName: string;
  model: string;
  partNumber: string;
  oemName: string;
  oemPartNumber: string;
  productUrl: string;
  unit: string;
  itemType: ItemType;
  condition: ItemCondition;
  conditionNote: string;
  eccn: string;
  usHts: string;
  ccats: string;
  coo: string;
  notes: string;
  attributeValues: Record<string, string>;
  drafts: DraftAttribute[];
  pendingCount: number;
  draftName: string;
  draftType: DataType;
  draftUnit: string;
  draftUsesList: boolean;
};

const EMPTY_ITEM: ItemSnapshot = {
  sku: "",
  name: "",
  description: "",
  quantity: "",
  taxonomyName: "",
  longCode: "",
  shortCode: "",
  manufacturerId: null,
  manufacturerName: "",
  model: "",
  partNumber: "",
  oemName: "",
  oemPartNumber: "",
  productUrl: "",
  unit: DEFAULT_UNIT,
  itemType: DEFAULT_ITEM_TYPE,
  condition: DEFAULT_CONDITION,
  conditionNote: "",
  eccn: DEFAULT_ECCN,
  usHts: "",
  ccats: "",
  coo: "",
  notes: "",
  attributeValues: {},
  drafts: [],
  pendingCount: 0,
  draftName: "",
  draftType: "text",
  draftUnit: "",
  draftUsesList: true,
};

export function ItemForm({ mode, itemId }: ItemFormProps) {
  const router = useRouter();
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([]);
  const [sku, setSku] = useState("");
  const [skuLocked, setSkuLocked] = useState(mode === "create");
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
  const [oemName, setOemName] = useState("");
  const [oemPartNumber, setOemPartNumber] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [unit, setUnit] = useState(DEFAULT_UNIT);
  const [units, setUnits] = useState<string[]>([...SEEDED_UNITS]);
  const [itemType, setItemType] = useState<ItemType>(DEFAULT_ITEM_TYPE);
  const [condition, setCondition] = useState<ItemCondition>(DEFAULT_CONDITION);
  const [conditionNote, setConditionNote] = useState("");
  const [eccn, setEccn] = useState(DEFAULT_ECCN);
  const [usHts, setUsHts] = useState("");
  const [ccats, setCcats] = useState("");
  const [coo, setCoo] = useState("");
  const [notes, setNotes] = useState("");
  const [attributeLinks, setAttributeLinks] = useState<{ id: string; name: string; value: string }[]>([]);
  const [changeTaxonomy, setChangeTaxonomy] = useState(false);
  const [changingTaxonomy, setChangingTaxonomy] = useState(false);
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
  const [baseline, setBaseline] = useState<ItemSnapshot>(EMPTY_ITEM);
  const savingRef = useRef(false);

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
        const [taxonomyRows, countryRows, unitRows, item, previewSku] = await Promise.all([
          fetchTaxonomies(),
          fetchCountries(),
          fetchUnits(),
          mode === "edit" && itemId ? fetchItem(itemId) : Promise.resolve(null),
          mode === "create" ? previewNewItemSku() : Promise.resolve(""),
        ]);
        if (cancelled) return;
        setTaxonomies(taxonomyRows);
        setCountries(countryRows);
        setUnits(unitRows);
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
          const nextUnit = unitOrDefault(item.unit, unitRows);
          setModel(item.model);
          setPartNumber(item.partNumber);
          setOemName(item.oemName);
          setOemPartNumber(item.oemPartNumber);
          setProductUrl(item.productUrl);
          setUnit(nextUnit);
          setItemType(item.itemType);
          setCondition(item.condition);
          setConditionNote(item.conditionNote);
          setEccn(item.eccn || DEFAULT_ECCN);
          setUsHts(item.usHts);
          setCcats(item.ccats);
          setCoo(item.coo);
          setNotes(item.notes);
          setAttributeLinks(item.attributeLinks);
          setSkuLocked(false);
          setBaseline({
            sku: item.sku,
            name: item.name,
            description: item.description,
            quantity: item.quantity === null ? "" : String(item.quantity),
            taxonomyName: taxonomy?.name ?? "",
            longCode: "",
            shortCode: "",
            manufacturerId: item.manufacturerId,
            manufacturerName: item.manufacturerName,
            model: item.model,
            partNumber: item.partNumber,
            oemName: item.oemName,
            oemPartNumber: item.oemPartNumber,
            productUrl: item.productUrl,
            unit: nextUnit,
            itemType: item.itemType,
            condition: item.condition,
            conditionNote: item.conditionNote,
            eccn: item.eccn || DEFAULT_ECCN,
            usHts: item.usHts,
            ccats: item.ccats,
            coo: item.coo,
            notes: item.notes,
            attributeValues: values,
            drafts: [],
            pendingCount: 0,
            draftName: "",
            draftType: "text",
            draftUnit: "",
            draftUsesList: true,
          });
        } else if (previewSku) {
          setSku(previewSku);
          setSkuLocked(true);
          setBaseline((current) => ({ ...current, sku: previewSku }));
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

  const unitChoices = useMemo(() => {
    const names = units.length > 0 ? [...units] : [...SEEDED_UNITS];
    if (unit && !names.some((name) => name.toLowerCase() === unit.toLowerCase())) names.push(unit);
    return names;
  }, [units, unit]);

  const snapshot: ItemSnapshot = {
    sku,
    name,
    description,
    quantity,
    taxonomyName,
    longCode,
    shortCode,
    manufacturerId,
    manufacturerName,
    model,
    partNumber,
    oemName,
    oemPartNumber,
    productUrl,
    unit,
    itemType,
    condition,
    conditionNote,
    eccn,
    usHts,
    ccats,
    coo,
    notes,
    attributeValues,
    drafts,
    pendingCount: pendingImages.length,
    draftName,
    draftType,
    draftUnit,
    draftUsesList,
  };
  const dirty = isDirty(snapshot, baseline) || manufacturerUnresolved;

  async function save(): Promise<boolean> {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaveError(null);
    setSaved(false);
    try {
    const trimmedName = name.trim();
    const trimmedSku = sku.trim();
    const trimmedTaxonomy = taxonomy?.name ?? taxonomyName.trim();
    if (!trimmedName) {
      setSaveError("Name is required.");
      return false;
    }
    if ((mode !== "create" || !skuLocked) && !trimmedSku) {
      setSaveError("SKU is required.");
      return false;
    }
    if (mode === "create" && !trimmedTaxonomy) {
      setSaveError("Choose a taxonomy.");
      return false;
    }
    if (manufacturerUnresolved) {
      setSaveError("Choose a manufacturer from the list, or add the new name.");
      return false;
    }
    const htsProblem = htsError(usHts);
    if (htsProblem) {
      setSaveError(`US HTS: ${htsProblem}`);
      return false;
    }
    const urlProblem = productUrlError(productUrl);
    if (urlProblem) {
      setSaveError(urlProblem);
      return false;
    }

    const creatingTaxonomy = trimmedTaxonomy !== "" && !taxonomy;
    let longCodeValue: string | null = null;
    let shortCodeValue: string | null = null;
    if (creatingTaxonomy) {
      longCodeValue = longCode.trim().toUpperCase();
      shortCodeValue = shortCode.trim().toUpperCase();
      if (!/^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(longCodeValue)) {
        setSaveError("Long code must be uppercase letters, digits, and slashes, like CRD/NIC.");
        return false;
      }
      if (!/^[A-Z0-9]{3}$/.test(shortCodeValue)) {
        setSaveError("Short code must be exactly 3 letters or digits.");
        return false;
      }
    }

    const quantityText = quantity.trim();
    const parsedQuantity = quantityText === "" ? null : Number(quantityText);
    if (parsedQuantity !== null && (!Number.isFinite(parsedQuantity) || !Number.isInteger(parsedQuantity))) {
      setSaveError("Quantity must be a whole number.");
      return false;
    }

    const attributes: Record<string, string> = {};
    for (const attribute of taxonomy?.attributes ?? []) {
      const value = (attributeValues[attribute.name] ?? "").trim();
      if (!value) continue;
      const problem = attributeValueError(attribute.data_type, value);
      if (problem) {
        setSaveError(`${attribute.name}: ${problem}`);
        return false;
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
          return false;
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
      sku: mode === "create" ? skuSubmittedForCreate(!skuLocked, trimmedSku) : trimmedSku,
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
      oemName,
      oemPartNumber,
      productUrl,
      unit,
      itemType,
      condition,
      conditionNote,
      eccn,
      usHts,
      ccats,
      coo,
    };

    setSaving(true);
      if (mode === "create") {
        const id = createdId ?? (await createItem(input));
        setCreatedId(id);
        if (notes.trim()) await saveItemNotes(id, notes);
        if (pendingImages.length > 0) {
          await uploadItemImages(
            id,
            pendingImages.map((image) => image.file),
          );
        }
        router.push(`/items/${id}`);
        return true;
      }
      if (!itemId) throw new Error("Missing item id.");
      await updateItem(itemId, input);
      await saveItemNotes(itemId, notes);
      const refreshed = await fetchTaxonomies();
      setTaxonomies(refreshed);
      const match = refreshed.find((row) => row.name.toLowerCase() === trimmedTaxonomy.toLowerCase());
      const nextTaxonomyName = match?.name ?? trimmedTaxonomy;
      setTaxonomyName(nextTaxonomyName);
      setLoadedTaxonomyName(match?.name ?? (trimmedTaxonomy || null));
      setLoadedAttributes(attributes);
      setAttributeValues(attributes);
      setDrafts([]);
      setBaseline({
        ...snapshot,
        taxonomyName: nextTaxonomyName,
        attributeValues: attributes,
        drafts: [],
      });
      setSaved(true);
      return true;
    } catch (error) {
      setSaveError(errorText(error));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || savingRef.current) return;
    await save();
  }

  const labelHref = sku.trim()
    ? `/labels?sku=${encodeURIComponent(sku.trim())}`
    : itemId
      ? `/labels?id=${itemId}`
      : "/labels";

  async function onPrint() {
    if (dirty) {
      if (!window.confirm(SAVE_BEFORE_LABEL)) return;
      const ok = await save();
      if (!ok) return;
    }
    router.push(labelHref);
  }

  async function onChangeTaxonomy() {
    if (!itemId) return;
    if (dirty) {
      if (!window.confirm(SAVE_BEFORE_TAXONOMY)) return;
      const ok = await save();
      if (!ok) return;
    }
    try {
      const item = await fetchItem(itemId);
      if (item) setAttributeLinks(item.attributeLinks);
    } catch (error) {
      setSaveError(errorText(error));
      return;
    }
    setChangeTaxonomy(true);
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

  return (
    <main className="page">
      <PageToolbar
        dirty={dirty}
        saving={saving}
        saved={saved}
        onSave={() => void save()}
        listen={!confirmDelete && !changeTaxonomy}
      >
        {mode === "edit" && itemId ? (
          <>
            <ToolbarButton icon={ScanBarcode} label="Print label" onClick={() => void onPrint()} disabled={saving || deleting} />
            <ToolbarButton
              icon={Shapes}
              label="Change taxonomy"
              onClick={() => void onChangeTaxonomy()}
              disabled={saving || deleting || changingTaxonomy}
            />
            <ToolbarSeparator />
            <ToolbarButton
              icon={Trash2}
              label="Delete item"
              danger
              disabled={saving || deleting}
              onClick={() => setConfirmDelete(true)}
            />
          </>
        ) : null}
      </PageToolbar>
      {saveError ? (
        <p className="banner error" role="alert">
          {saveError}
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
              readOnly={mode === "create" && skuLocked}
              required={mode !== "create" || !skuLocked}
            />
            {mode === "create" ? (
              skuLocked ? (
                <>
                  <span className="hint">Preview of the next number. It is assigned when you save.</span>
                  <button type="button" className="secondary" onClick={() => setSkuLocked(false)}>
                    Edit SKU
                  </button>
                </>
              ) : (
                <span className="hint">This SKU will be saved as typed.</span>
              )
            ) : null}
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
          Notes
          <textarea
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              setSaved(false);
            }}
          />
          <span className="hint">Optional. A taxonomy change can append removed field values here.</span>
        </label>
        {mode === "edit" ? (
          <div className="taxonomy-lock">
            <label>
              Taxonomy
              <input
                value={
                  taxonomy
                    ? taxonomy.shortCode
                      ? `${taxonomy.shortCode} — ${taxonomy.name}`
                      : taxonomy.name
                    : "No taxonomy"
                }
                readOnly
              />
            </label>
            </div>
        ) : (
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
        )}
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
            <label>
              Item type
              <select
                aria-label="Item type"
                value={itemType}
                onChange={(event) => {
                  const next = ITEM_TYPES.find((type) => type === event.target.value) ?? DEFAULT_ITEM_TYPE;
                  setItemType(next);
                  setSaved(false);
                }}
              >
                {ITEM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
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
              OEM name
              <input
                value={oemName}
                autoComplete="off"
                onChange={(event) => {
                  setOemName(event.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <label>
              OEM part number
              <input
                value={oemPartNumber}
                autoComplete="off"
                onChange={(event) => {
                  setOemPartNumber(event.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <label>
              Product page
              <input
                type="url"
                inputMode="url"
                value={productUrl}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://"
                onChange={(event) => {
                  setProductUrl(event.target.value);
                  setSaved(false);
                }}
              />
              {productUrl.trim() && productUrlError(productUrl) ? (
                <span className="error-text">{productUrlError(productUrl)}</span>
              ) : productUrlHref(productUrl) ? (
                <a href={productUrlHref(productUrl) ?? undefined} target="_blank" rel="noopener noreferrer">
                  Open product page
                </a>
              ) : (
                <span className="hint">Optional http or https address.</span>
              )}
            </label>
            <label>
              Unit
              <select
                aria-label="Unit"
                value={unit}
                onChange={(event) => {
                  setUnit(event.target.value);
                  setSaved(false);
                }}
              >
                {unitChoices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
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
                    required: false,
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
      </form>
      {changeTaxonomy && mode === "edit" && itemId ? (
        <ChangeTaxonomyDialog
          taxonomies={taxonomies}
          current={taxonomy}
          values={attributeLinks}
          sku={sku}
          busy={changingTaxonomy}
          onCancel={() => {
            if (!changingTaxonomy) setChangeTaxonomy(false);
          }}
          onConfirm={(choice) => {
            setChangingTaxonomy(true);
            setSaveError(null);
            changeItemTaxonomy({ id: itemId, ...choice })
              .then(async (result) => {
                const [refreshed, item] = await Promise.all([fetchTaxonomies(), fetchItem(itemId)]);
                setTaxonomies(refreshed);
                if (!item) return;
                const match = refreshed.find((row) => row.id === item.taxonomyId) ?? null;
                const values: Record<string, string> = {};
                for (const link of item.attributeLinks) {
                  const attribute = match?.attributes.find((row) => row.id === link.id);
                  values[attribute?.name ?? link.name] = attribute ? canonicalValue(attribute, link.value) : link.value;
                }
                setSku(result.sku || item.sku);
                setNotes(result.notes);
                setTaxonomyName(match?.name ?? "");
                setLoadedTaxonomyName(match?.name ?? null);
                setLoadedAttributes(values);
                setAttributeValues(values);
                setAttributeLinks(item.attributeLinks);
                setDrafts([]);
                setSaved(true);
                setBaseline({
                  sku: result.sku || item.sku,
                  name,
                  description,
                  quantity,
                  taxonomyName: match?.name ?? "",
                  longCode,
                  shortCode,
                  manufacturerId,
                  manufacturerName,
                  model,
                  partNumber,
                  oemName,
                  oemPartNumber,
                  productUrl,
                  unit,
                  itemType,
                  condition,
                  conditionNote,
                  eccn,
                  usHts,
                  ccats,
                  coo,
                  notes: result.notes,
                  attributeValues: values,
                  drafts: [],
                  pendingCount: pendingImages.length,
                  draftName,
                  draftType,
                  draftUnit,
                  draftUsesList,
                });
                setChangeTaxonomy(false);
              })
              .catch((error: unknown) => setSaveError(errorText(error)))
              .finally(() => setChangingTaxonomy(false));
          }}
        />
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
