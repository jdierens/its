"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Copy, ScanBarcode, Shapes, Trash2 } from "lucide-react";
import {
  AttributeValueField,
  attributeValueError,
  canonicalValue,
} from "@/components/AttributeValueField";
import { usePageMeta } from "@/components/AppShell";
import { ChangeTaxonomyDialog } from "@/components/ChangeTaxonomyDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CountrySelect } from "@/components/CountrySelect";
import { FastArea, FastInput } from "@/components/FastField";
import { ITEM_CAMERA_INPUT_ID, ItemGallery, type PendingImage } from "@/components/ItemGallery";
import { ItemRecipe } from "@/components/ItemRecipe";
import { UsedInKits } from "@/components/UsedInKits";
import { setItemGeneric } from "@/lib/kits";
import { ManufacturerSelect } from "@/components/ManufacturerSelect";
import { PageToolbar, ToolbarButton, ToolbarSeparator } from "@/components/PageToolbar";
import { fetchCountries, type Country } from "@/lib/countries";
import { errorText } from "@/lib/errors";
import { isDirty, SAVE_BEFORE_LABEL, SAVE_BEFORE_TAXONOMY } from "@/lib/formDirty";
import { itemLabelHref } from "@/lib/labelReturn";
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
import { isMemoryTaxonomy, memoryAttributeSlot, memorySlotRank } from "@/lib/itemFormDensity";
import { assertDuplicateSave, fetchDuplicateSource, saveDuplicatePrices } from "@/lib/duplicateItemServer";
import { sameItemName, skuReusesSource } from "@/lib/duplicateItem";
import { changeItemTaxonomy, createItem, deleteItem, fetchItem, fetchTaxonomies, saveItemNotes, updateItem } from "@/lib/items";
import { parseMoney } from "@/lib/pricing/quotes";
import { productUrlError, productUrlHref } from "@/lib/productUrl";
import { itemsListHref } from "@/lib/itemsReturn";
import { previewNewItemSku, skuSubmittedForCreate } from "@/lib/sku";
import { fetchUnits } from "@/lib/units";
import type { AttributeDefinition, DataType, Taxonomy } from "@/lib/types";

type ItemFormProps = {
  mode: "create" | "edit";
  itemId?: string;
  sourceId?: string;
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
  ecommercePrice: string;
  marketPrice: string;
  msrp: string;
};

const EMPTY_ITEM: ItemSnapshot = {
  sku: "",
  name: "",
  description: "",
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
  ecommercePrice: "",
  marketPrice: "",
  msrp: "",
};

function bindText(live: Map<string, string>, key: string, value: string, commit: (next: string) => void) {
  return {
    value,
    onDraft: (next: string) => {
      live.set(key, next);
    },
    onValue: commit,
  };
}

export function ItemForm({ mode, itemId, sourceId }: ItemFormProps) {
  const router = useRouter();
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([]);
  const [sku, setSku] = useState("");
  const [skuLocked, setSkuLocked] = useState(mode === "create");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [onHand, setOnHand] = useState<number | null>(null);
  const [itemsHref, setItemsHref] = useState("/items");
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
  const [isGeneric, setIsGeneric] = useState(false);
  const [detailTab, setDetailTab] = useState<"details" | "recipe">("details");
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
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [sourceSku, setSourceSku] = useState("");
  const [showPrices, setShowPrices] = useState(false);
  const [ecommercePrice, setEcommercePrice] = useState("");
  const [marketPrice, setMarketPrice] = useState("");
  const [msrp, setMsrp] = useState("");
  const savingRef = useRef(false);
  const live = useRef(new Map<string, string>());

  useEffect(() => {
    setItemsHref(itemsListHref());
  }, []);

  usePageMeta({
    title: mode === "create" ? "New item" : name.trim() || "Edit item",
    backHref: itemsHref,
    backLabel: "Back to items",
    crumbs: [
      { label: "Inventory" },
      { label: "Items", href: itemsHref },
      { label: mode === "create" ? "New item" : name.trim() || "Edit item" },
    ],
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [taxonomyRows, countryRows, unitRows, item, previewSku, source] = await Promise.all([
          fetchTaxonomies(),
          fetchCountries(),
          fetchUnits(),
          mode === "edit" && itemId ? fetchItem(itemId) : Promise.resolve(null),
          mode === "create" ? previewNewItemSku() : Promise.resolve(""),
          mode === "create" && sourceId ? fetchDuplicateSource(sourceId) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        live.current.clear();
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
          setOnHand(typeof item.quantity === "number" ? item.quantity : null);
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
          setIsGeneric(item.isGeneric);
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
            ecommercePrice: "",
            marketPrice: "",
            msrp: "",
          });
        } else if (sourceId && !source) {
          setMissing(true);
        } else if (source) {
          const taxonomy = taxonomyRows.find((row) => row.id === source.taxonomyId) ?? null;
          const values: Record<string, string> = {};
          for (const [attributeName, value] of Object.entries(source.attributes)) {
            const attribute = taxonomy?.attributes.find(
              (row) => row.name.toLowerCase() === attributeName.toLowerCase(),
            );
            values[attribute?.name ?? attributeName] = attribute ? canonicalValue(attribute, value) : value;
          }
          const nextUnit = unitOrDefault(source.unit, unitRows);
          const prices = source.prices ?? { ecommercePrice: "", marketPrice: "", msrp: "" };
          setSourceName(source.sourceName);
          setSourceSku(source.sourceSku);
          setShowPrices(source.prices !== null);
          setEcommercePrice(prices.ecommercePrice);
          setMarketPrice(prices.marketPrice);
          setMsrp(prices.msrp);
          setSku(previewSku);
          setSkuLocked(true);
          setName(source.name);
          setDescription(source.description);
          setOnHand(null);
          setTaxonomyName(taxonomy?.name ?? "");
          setLoadedTaxonomyName(taxonomy?.name ?? null);
          setLoadedAttributes(values);
          setAttributeValues(values);
          setManufacturerId(source.manufacturerId);
          setManufacturerName(source.manufacturerName);
          setModel(source.model);
          setPartNumber(source.partNumber);
          setOemName(source.oemName);
          setOemPartNumber(source.oemPartNumber);
          setProductUrl(source.productUrl);
          setUnit(nextUnit);
          setItemType(source.itemType);
          setCondition(source.condition);
          setConditionNote(source.conditionNote);
          setEccn(source.eccn || DEFAULT_ECCN);
          setUsHts(source.usHts);
          setCcats(source.ccats);
          setCoo(source.coo);
          setNotes(source.notes);
          setBaseline({
            sku: previewSku,
            name: source.name,
            description: source.description,
            taxonomyName: taxonomy?.name ?? "",
            longCode: "",
            shortCode: "",
            manufacturerId: source.manufacturerId,
            manufacturerName: source.manufacturerName,
            model: source.model,
            partNumber: source.partNumber,
            oemName: source.oemName,
            oemPartNumber: source.oemPartNumber,
            productUrl: source.productUrl,
            unit: nextUnit,
            itemType: source.itemType,
            condition: source.condition,
            conditionNote: source.conditionNote,
            eccn: source.eccn || DEFAULT_ECCN,
            usHts: source.usHts,
            ccats: source.ccats,
            coo: source.coo,
            notes: source.notes,
            attributeValues: values,
            drafts: [],
            pendingCount: 0,
            draftName: "",
            draftType: "text",
            draftUnit: "",
            draftUsesList: true,
            ecommercePrice: prices.ecommercePrice,
            marketPrice: prices.marketPrice,
            msrp: prices.msrp,
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
  }, [mode, itemId, sourceId]);

  const taxonomy = useMemo(() => {
    const query = taxonomyName.trim().toLowerCase();
    if (!query) return null;
    return taxonomies.find((row) => row.name.toLowerCase() === query) ?? null;
  }, [taxonomies, taxonomyName]);

  const isNewTaxonomy = taxonomyName.trim() !== "" && !taxonomy;

  function onTaxonomyChange(nextName: string) {
    for (const key of [...live.current.keys()]) {
      if (key.startsWith("attr:")) live.current.delete(key);
    }
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
    const trimmed = read("draftName", draftName).trim();
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
        unit: read("draftUnit", draftUnit).trim(),
        uses_list: draftUsesList,
      },
    ]);
    live.current.delete("draftName");
    live.current.delete("draftUnit");
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

  function read(key: string, fallback: string) {
    return live.current.has(key) ? (live.current.get(key) as string) : fallback;
  }

  function currentSnapshot(): ItemSnapshot {
    const attributes = { ...attributeValues };
    for (const [key, value] of live.current) {
      if (key.startsWith("attr:")) attributes[key.slice(5)] = value;
    }
    return {
      sku: read("sku", sku),
      name: read("name", name),
      description: read("description", description),
      taxonomyName: read("taxonomyName", taxonomyName),
      longCode: read("longCode", longCode),
      shortCode: read("shortCode", shortCode),
      manufacturerId,
      manufacturerName,
      model: read("model", model),
      partNumber: read("partNumber", partNumber),
      oemName: read("oemName", oemName),
      oemPartNumber: read("oemPartNumber", oemPartNumber),
      productUrl: read("productUrl", productUrl),
      unit,
      itemType,
      condition,
      conditionNote: read("conditionNote", conditionNote),
      eccn: read("eccn", eccn),
      usHts: read("usHts", usHts),
      ccats: read("ccats", ccats),
      coo,
      notes: read("notes", notes),
      attributeValues: attributes,
      drafts,
      pendingCount: pendingImages.length,
      draftName: read("draftName", draftName),
      draftType,
      draftUnit: read("draftUnit", draftUnit),
      draftUsesList,
      ecommercePrice: read("ecommercePrice", ecommercePrice),
      marketPrice: read("marketPrice", marketPrice),
      msrp: read("msrp", msrp),
    };
  }

  const snapshot = currentSnapshot();
  const dirty = isDirty(snapshot, baseline) || manufacturerUnresolved;

  async function save(): Promise<boolean> {
    if (savingRef.current) return false;
    const current = currentSnapshot();
    if (!isDirty(current, baseline) && !manufacturerUnresolved) return false;
    savingRef.current = true;
    setSaveError(null);
    setSaved(false);
    try {
    const trimmedName = current.name.trim();
    const trimmedSku = current.sku.trim();
    const taxonomyMatch =
      taxonomies.find((row) => row.name.toLowerCase() === current.taxonomyName.trim().toLowerCase()) ?? null;
    const trimmedTaxonomy = taxonomyMatch?.name ?? current.taxonomyName.trim();
    const submittedSku = mode === "create" ? skuSubmittedForCreate(!skuLocked, trimmedSku) : trimmedSku;
    if (!trimmedName) {
      setSaveError("Name is required.");
      return false;
    }
    if (sourceName && sameItemName(trimmedName, sourceName)) {
      setSaveError("Change the name so this item is distinct from the original.");
      return false;
    }
    if ((mode !== "create" || !skuLocked) && !trimmedSku) {
      setSaveError("SKU is required.");
      return false;
    }
    if (sourceSku && skuReusesSource(submittedSku, sourceSku)) {
      setSaveError("Choose a new SKU. The original SKU stays on the source item.");
      return false;
    }
    if (showPrices) {
      const ecommerce = parseMoney(current.ecommercePrice);
      const market = parseMoney(current.marketPrice);
      const retail = parseMoney(current.msrp);
      if (!ecommerce.ok) {
        setSaveError(`Ecommerce price: ${ecommerce.message}`);
        return false;
      }
      if (!market.ok) {
        setSaveError(`Market price: ${market.message}`);
        return false;
      }
      if (!retail.ok) {
        setSaveError(`MSRP: ${retail.message}`);
        return false;
      }
    }
    if (mode === "create" && !trimmedTaxonomy) {
      setSaveError("Choose a taxonomy.");
      return false;
    }
    if (manufacturerUnresolved) {
      setSaveError("Choose a manufacturer from the list, or add the new name.");
      return false;
    }
    const htsProblem = htsError(current.usHts);
    if (htsProblem) {
      setSaveError(`US HTS: ${htsProblem}`);
      return false;
    }
    const urlProblem = productUrlError(current.productUrl);
    if (urlProblem) {
      setSaveError(urlProblem);
      return false;
    }

    const creatingTaxonomy = trimmedTaxonomy !== "" && !taxonomy;
    let longCodeValue: string | null = null;
    let shortCodeValue: string | null = null;
    if (creatingTaxonomy) {
      longCodeValue = current.longCode.trim().toUpperCase();
      shortCodeValue = current.shortCode.trim().toUpperCase();
      if (!/^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(longCodeValue)) {
        setSaveError("Long code must be uppercase letters, digits, and slashes, like CRD/NIC.");
        return false;
      }
      if (!/^[A-Z0-9]{3}$/.test(shortCodeValue)) {
        setSaveError("Short code must be exactly 3 letters or digits.");
        return false;
      }
    }

    const attributes: Record<string, string> = {};
    for (const attribute of taxonomyMatch?.attributes ?? []) {
      const value = (current.attributeValues[attribute.name] ?? "").trim();
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
      const value = (current.attributeValues[draft.key] ?? "").trim();
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
      sku: submittedSku,
      description: current.description.trim(),
      taxonomyName: trimmedTaxonomy || null,
      attributes,
      attributeDefs,
      longCode: longCodeValue,
      shortCode: shortCodeValue,
      manufacturerId,
      model: current.model,
      partNumber: current.partNumber,
      oemName: current.oemName,
      oemPartNumber: current.oemPartNumber,
      productUrl: current.productUrl,
      unit,
      itemType,
      condition,
      conditionNote: current.conditionNote,
      eccn: current.eccn,
      usHts: current.usHts,
      ccats: current.ccats,
      coo,
    };

    setSaving(true);
      if (mode === "create") {
        if (sourceId) await assertDuplicateSave({ sourceId, name: trimmedName, sku: submittedSku });
        const id = createdId ?? (await createItem(input));
        setCreatedId(id);
        if (current.notes.trim()) await saveItemNotes(id, current.notes);
        if (showPrices) {
          await saveDuplicatePrices(id, {
            ecommercePrice: current.ecommercePrice,
            marketPrice: current.marketPrice,
            msrp: current.msrp,
          });
        }
        if (pendingImages.length > 0) {
          await uploadItemImages(
            id,
            pendingImages.map((image) => image.file),
          );
        }
        await setItemGeneric(id, isGeneric);
        router.push(`/items/${id}`);
        return true;
      }
      if (!itemId) throw new Error("Missing item id.");
      await updateItem(itemId, input);
      await saveItemNotes(itemId, current.notes);
      await setItemGeneric(itemId, isGeneric);
      const refreshed = await fetchTaxonomies();
      setTaxonomies(refreshed);
      const match = refreshed.find((row) => row.name.toLowerCase() === trimmedTaxonomy.toLowerCase());
      const nextTaxonomyName = match?.name ?? trimmedTaxonomy;
      setTaxonomyName(nextTaxonomyName);
      setLoadedTaxonomyName(match?.name ?? (trimmedTaxonomy || null));
      setLoadedAttributes(attributes);
      setAttributeValues(attributes);
      setDrafts([]);
      live.current.clear();
      setBaseline({
        ...current,
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
    await save();
  }

  const labelHref = itemLabelHref(itemId ?? null, snapshot.sku);

  async function onPrint() {
    if (isDirty(currentSnapshot(), baseline) || manufacturerUnresolved) {
      if (!window.confirm(SAVE_BEFORE_LABEL)) return;
      const ok = await save();
      if (!ok) return;
    }
    router.push(labelHref);
  }

  async function onChangeTaxonomy() {
    if (!itemId) return;
    if (isDirty(currentSnapshot(), baseline) || manufacturerUnresolved) {
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
      router.push(itemsListHref());
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
        <Link href={itemsHref}>Back to items</Link>
      </main>
    );
  }

  if (missing) {
    return (
      <main className="page">
        <p>Item not found.</p>
        <p className="muted">That item is not in the inventory.</p>
        <Link href={itemsHref}>Back to items</Link>
      </main>
    );
  }

  const memoryLead = (taxonomy?.attributes ?? [])
    .flatMap((attribute, index) => {
      if (!isMemoryTaxonomy(taxonomy?.shortCode)) return [];
      const slot = memoryAttributeSlot(attribute.name);
      return slot ? [{ attribute, index, slot }] : [];
    })
    .sort((a, b) => memorySlotRank(a.slot) - memorySlotRank(b.slot) || a.index - b.index);
  const memoryLeadIds = new Set(memoryLead.map((row) => row.attribute.id));

  return (
    <main className="page">
      <PageToolbar
        dirty={dirty}
        saving={saving}
        saved={saved}
        onSave={() => void save()}
        attemptSave
        listen={!confirmDelete && !changeTaxonomy}
      >
        {mode === "edit" && itemId ? (
          <>
            <ToolbarButton icon={Copy} label="Duplicate" href={`/items/new?from=${itemId}`} disabled={saving || deleting} />
            <label className="icon-button" htmlFor={ITEM_CAMERA_INPUT_ID} title="Take photo" aria-label="Take photo">
              <Camera size={18} strokeWidth={1.75} aria-hidden />
            </label>
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
      {sourceName ? (
        <p className="banner">
          Copied from {sourceSku ? `${sourceSku} ` : ""}
          {sourceName}. Nothing is saved until you press Save. Change the name first.
        </p>
      ) : null}
      {mode === "edit" && itemId && itemType === "Kit/Package" ? (
        <div className="kit-tabs" role="tablist" aria-label="Item sections">
          <button type="button" role="tab" aria-selected={detailTab === "details"} onClick={() => setDetailTab("details")}>
            Details
          </button>
          <button type="button" role="tab" aria-selected={detailTab === "recipe"} onClick={() => setDetailTab("recipe")}>
            Recipe
          </button>
        </div>
      ) : null}
      {mode === "edit" && itemId && itemType === "Kit/Package" && detailTab === "recipe" ? (
        <ItemRecipe
          itemId={itemId}
          taxonomyCode={taxonomy?.longCode ?? ""}
          onApplyDefaults={(nextCondition, nextEccn) => {
            if (nextCondition === "New" || nextCondition === "Used") setCondition(nextCondition);
            if (nextEccn) setEccn(nextEccn);
            setSaved(false);
          }}
        />
      ) : null}
      <form
        className="item-form"
        onSubmit={onSubmit}
        noValidate
        hidden={mode === "edit" && itemType === "Kit/Package" && detailTab === "recipe"}
      >
        <div className="item-identity">
          <label className="item-sku">
            SKU
            <FastInput
              {...bindText(live.current, "sku", sku, (next) => {
                setSku(next);
                setSaved(false);
              })}
              autoComplete="off"
              readOnly={mode === "create" && skuLocked}
              required={mode !== "create" || !skuLocked}
              spellCheck={false}
            />
            {mode === "create" ? (
              skuLocked ? (
                <>
                  <span className="hint">
                    Preview of the next number. It is assigned when you save.
                    {sourceName ? " The original SKU is not reused." : ""}
                  </span>
                  <button type="button" className="secondary" onClick={() => setSkuLocked(false)}>
                    Edit SKU
                  </button>
                </>
              ) : (
                <span className="hint">This SKU will be saved as typed.</span>
              )
            ) : null}
            {sourceSku && !skuLocked && skuReusesSource(snapshot.sku, sourceSku) ? (
              <span className="field-error" role="alert">
                Choose a new SKU. The original SKU stays on the source item.
              </span>
            ) : null}
          </label>
          <label className="item-name">
            Name
            {isGeneric ? <span className="code-badge">Generic</span> : null}
            <FastInput
              {...bindText(live.current, "name", name, (next) => {
                setName(next);
                setSaved(false);
              })}
              autoComplete="off"
              required
              maxLength={Math.max(80, snapshot.name.length)}
              aria-invalid={sourceName !== null && sameItemName(snapshot.name, sourceName)}
              aria-describedby={sourceName ? "duplicate-name" : undefined}
            />
            {sourceName && sameItemName(snapshot.name, sourceName) ? (
              <span className="field-error" id="duplicate-name" role="alert">
                Change the name so this item is distinct from the original.
              </span>
            ) : null}
          </label>
          <div className="on-hand">
            <span className="on-hand-label">On hand</span>
            <strong className="on-hand-value">{onHand === null ? "—" : onHand.toLocaleString("en-US")}</strong>
          </div>
        </div>
        {sourceName ? (
          <p className="hint">On-hand quantity starts empty. The original quantity is not copied.</p>
        ) : null}
        <label>
          Description
          <FastArea
            {...bindText(live.current, "description", description, (next) => {
              setDescription(next);
              setSaved(false);
            })}
          />
        </label>
        <label>
          Notes
          <FastArea
            {...bindText(live.current, "notes", notes, (next) => {
              setNotes(next);
              setSaved(false);
            })}
          />
          <span className="hint">Optional. A taxonomy change can append removed field values here.</span>
        </label>
        {showPrices ? (
          <div className="grid">
            <label>
              Ecommerce price
              <span className="hint">Copied amounts only. Quote history and price dates are not copied.</span>
              <FastInput
                className="num"
                inputMode="decimal"
                autoComplete="off"
                {...bindText(live.current, "ecommercePrice", ecommercePrice, (next) => {
                  setEcommercePrice(next);
                  setSaved(false);
                })}
              />
            </label>
            <label>
              Market price
              <FastInput
                className="num"
                inputMode="decimal"
                autoComplete="off"
                {...bindText(live.current, "marketPrice", marketPrice, (next) => {
                  setMarketPrice(next);
                  setSaved(false);
                })}
              />
            </label>
            <label>
              MSRP
              <FastInput
                className="num"
                inputMode="decimal"
                autoComplete="off"
                {...bindText(live.current, "msrp", msrp, (next) => {
                  setMsrp(next);
                  setSaved(false);
                })}
              />
            </label>
          </div>
        ) : null}
        <fieldset>
          <legend>Main</legend>
          <div className="item-main-row item-lead-row">
            <label data-field="type">
              Type
              <select
                aria-label="Type"
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
            <label className="kit-check">
              <input
                type="checkbox"
                checked={isGeneric}
                onChange={(event) => {
                  setIsGeneric(event.target.checked);
                  setSaved(false);
                }}
              />
              Generic part
            </label>
            {mode === "edit" ? (
              <label data-field="taxonomy">
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
            ) : (
              <label data-field="taxonomy">
                Taxonomy
                <FastInput
                  list="taxonomy-names"
                  placeholder="Select or type a taxonomy"
                  autoComplete="off"
                  {...bindText(live.current, "taxonomyName", taxonomyName, (next) => {
                    onTaxonomyChange(next);
                    setSaved(false);
                  })}
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
            <label data-field="unit">
              Unit
              <select
                aria-label="Unit"
                value={unit}
                onChange={(event) => {
                  setUnit(event.target.value);
                  setSaved(false);
                }}
              >
                {unitChoices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            </label>
            <label data-field="condition">
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
              <label data-field="condition-note">
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
              <label data-field="condition-note">
                Condition note
                <FastInput
                  autoComplete="off"
                  {...bindText(live.current, "conditionNote", conditionNote, (next) => {
                    setConditionNote(next);
                    setSaved(false);
                  })}
                />
                <span className="hint">Optional.</span>
              </label>
            )}
          </div>
          {isNewTaxonomy ? (
            <div className="grid">
              <label>
                Long code
                <FastInput
                  placeholder="CRD/NIC"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  transform={(value) => value.toUpperCase()}
                  {...bindText(live.current, "longCode", longCode, (next) => {
                    setLongCode(next);
                    setSaved(false);
                  })}
                />
              </label>
              <label>
                Short code
                <FastInput
                  placeholder="NIC"
                  maxLength={3}
                  autoComplete="off"
                  spellCheck={false}
                  required
                  transform={(value) => value.toUpperCase().slice(0, 3)}
                  {...bindText(live.current, "shortCode", shortCode, (next) => {
                    setShortCode(next);
                    setSaved(false);
                  })}
                />
                <span className="hint">Exactly 3 letters or digits. Printed on the label.</span>
              </label>
            </div>
          ) : null}
          <div className="item-main-row">
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
              <FastInput
                autoComplete="off"
                {...bindText(live.current, "model", model, (next) => {
                  setModel(next);
                  setSaved(false);
                })}
              />
            </label>
            <label>
              Part number
              <FastInput
                autoComplete="off"
                {...bindText(live.current, "partNumber", partNumber, (next) => {
                  setPartNumber(next);
                  setSaved(false);
                })}
              />
            </label>
          </div>
          <div className="grid">
            <label>
              OEM name
              <FastInput
                autoComplete="off"
                {...bindText(live.current, "oemName", oemName, (next) => {
                  setOemName(next);
                  setSaved(false);
                })}
              />
            </label>
            <label>
              OEM part number
              <FastInput
                autoComplete="off"
                {...bindText(live.current, "oemPartNumber", oemPartNumber, (next) => {
                  setOemPartNumber(next);
                  setSaved(false);
                })}
              />
            </label>
            <label>
              Product page
              <FastInput
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://"
                {...bindText(live.current, "productUrl", productUrl, (next) => {
                  setProductUrl(next);
                  setSaved(false);
                })}
              />
              {snapshot.productUrl.trim() && productUrlError(snapshot.productUrl) ? (
                <span className="error-text">{productUrlError(snapshot.productUrl)}</span>
              ) : productUrlHref(snapshot.productUrl) ? (
                <a href={productUrlHref(snapshot.productUrl) ?? undefined} target="_blank" rel="noopener noreferrer">
                  Open product page
                </a>
              ) : (
                <span className="hint">Optional http or https address.</span>
              )}
            </label>
          </div>
        </fieldset>
        {taxonomyName.trim() ? (
          <fieldset>
            <legend>{taxonomy?.name ?? taxonomyName.trim()} attributes</legend>
            {memoryLead.length > 0 ? (
              <div className="item-attr-mem">
                {memoryLead.map((row) => (
                  <AttributeValueField
                    key={row.attribute.id}
                    attribute={row.attribute}
                    slot={row.slot}
                    value={attributeValues[row.attribute.name] ?? ""}
                    onDraft={(value) => {
                      live.current.set(`attr:${row.attribute.name}`, value);
                    }}
                    onChange={(value) => {
                      setAttributeValues((current) => ({ ...current, [row.attribute.name]: value }));
                      setSaved(false);
                    }}
                  />
                ))}
              </div>
            ) : null}
            <div className="grid item-attr-grid">
              {(taxonomy?.attributes ?? [])
                .filter((attribute) => !memoryLeadIds.has(attribute.id))
                .map((attribute) => (
                <AttributeValueField
                  key={attribute.id}
                  attribute={attribute}
                  value={attributeValues[attribute.name] ?? ""}
                  onDraft={(value) => {
                    live.current.set(`attr:${attribute.name}`, value);
                  }}
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
                  onDraft={(value) => {
                    live.current.set(`attr:${draft.key}`, value);
                  }}
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
                <FastInput
                  autoComplete="off"
                  {...bindText(live.current, "draftName", draftName, setDraftName)}
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
                <FastInput
                  autoComplete="off"
                  {...bindText(live.current, "draftUnit", draftUnit, setDraftUnit)}
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

        <fieldset>
          <legend>Trade compliance</legend>
          <div className="grid">
            <label>
              ECCN
              <FastInput
                autoComplete="off"
                spellCheck={false}
                {...bindText(live.current, "eccn", eccn, (next) => {
                  setEccn(next);
                  setSaved(false);
                })}
              />
              <span className="hint">Blank saves as {DEFAULT_ECCN}.</span>
            </label>
            <label>
              US HTS
              <FastInput
                autoComplete="off"
                spellCheck={false}
                placeholder="8471.30.0100"
                {...bindText(live.current, "usHts", usHts, (next) => {
                  setUsHts(next);
                  setSaved(false);
                })}
              />
              <span className="hint">Digits and optional dots, up to 10 digits.</span>
            </label>
            <label>
              CCATS
              <FastInput
                autoComplete="off"
                spellCheck={false}
                {...bindText(live.current, "ccats", ccats, (next) => {
                  setCcats(next);
                  setSaved(false);
                })}
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
        <ItemGallery
          itemId={mode === "edit" ? itemId : undefined}
          pending={pendingImages}
          onPendingChange={setPendingImages}
        />
      </form>
      {mode === "edit" && itemId ? <UsedInKits itemId={itemId} /> : null}
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
                setOnHand(typeof item.quantity === "number" ? item.quantity : null);
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
                  ecommercePrice,
                  marketPrice,
                  msrp,
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
