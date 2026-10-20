"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePageMeta } from "@/components/AppShell";
import { ManufacturerSelect } from "@/components/ManufacturerSelect";
import { errorText } from "@/lib/errors";
import { compressImage } from "@/lib/compressImage";
import { uploadItemImages } from "@/lib/images";
import { DEFAULT_ECCN, DEFAULT_ITEM_TYPE, DEFAULT_UNIT, ITEM_TYPES, itemTypeOrDefault, type ItemType } from "@/lib/itemFields";
import { createItem, fetchTaxonomies } from "@/lib/items";
import { conditionFromHints, suggestedItemName, type LensHit, type LensReading } from "@/lib/lens/rank";
import { reserveNewItemSku } from "@/lib/sku";
import type { AttributeDefinition, Taxonomy } from "@/lib/types";

const MAX_SHOTS = 4;
const LENS_EDGE = 1280;

type Shot = { key: string; file: File; url: string };

export function LensPage() {
  usePageMeta({ title: "Lens", crumbs: [{ label: "Inventory" }, { label: "Lens" }] });
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [reading, setReading] = useState<LensReading | null>(null);
  const [matches, setMatches] = useState<LensHit[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [manufacturerId, setManufacturerId] = useState<string | null>(null);
  const [manufacturerName, setManufacturerName] = useState("");
  const [unresolved, setUnresolved] = useState(false);
  const [model, setModel] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [oemPartNumber, setOemPartNumber] = useState("");
  const [taxonomyId, setTaxonomyId] = useState("");
  const [itemType, setItemType] = useState<ItemType>(DEFAULT_ITEM_TYPE);
  const [condition, setCondition] = useState<"New" | "Used">("Used");
  const [description, setDescription] = useState("");
  const onUnresolved = useCallback((value: boolean) => setUnresolved(value), []);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/lens")
      .then((response) => response.json())
      .then((body: { configured?: boolean }) => {
        if (!cancelled) setConfigured(body.configured === true);
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    fetchTaxonomies()
      .then((rows) => {
        if (!cancelled) setTaxonomies(rows);
      })
      .catch(() => {
        if (!cancelled) setTaxonomies([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const shot of shotsRef.current) URL.revokeObjectURL(shot.url);
    };
  }, []);

  async function addFiles(files: FileList | null) {
    const picked = Array.from(files ?? []);
    if (picked.length === 0) return;
    setMessage(null);
    const next = [...shots];
    try {
      for (const file of picked) {
        if (next.length >= MAX_SHOTS) break;
        const compressed = await compressImage(file, true, LENS_EDGE);
        next.push({ key: crypto.randomUUID(), file: compressed, url: URL.createObjectURL(compressed) });
      }
    } catch (error) {
      setMessage(errorText(error));
    }
    setShots(next);
  }

  function removeShot(key: string) {
    setShots((current) => {
      const shot = current.find((entry) => entry.key === key);
      if (shot) URL.revokeObjectURL(shot.url);
      return current.filter((entry) => entry.key !== key);
    });
  }

  async function identify() {
    if (shots.length === 0) return;
    setBusy(true);
    setMessage(null);
    setReading(null);
    setMatches([]);
    setCreating(false);
    try {
      const images = await Promise.all(shots.map(async (shot) => ({
        mimeType: shot.file.type || "image/jpeg",
        data: await fileData(shot.file),
      })));
      const response = await fetch("/api/lens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const body = (await response.json()) as {
        configured?: boolean;
        message?: string;
        reading?: LensReading | null;
        matches?: LensHit[];
      };
      if (body.configured === false) {
        setConfigured(false);
        return;
      }
      if (!response.ok || body.message) throw new Error(body.message || "Lens could not read those photos.");
      const next = body.reading ?? null;
      setReading(next);
      setMatches(body.matches ?? []);
      if (next) fillDraft(next);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function fillDraft(next: LensReading) {
    setName(suggestedItemName(next));
    setManufacturerId(null);
    setManufacturerName(next.manufacturer);
    setModel(next.model);
    setPartNumber(next.partNumbers[0] ?? "");
    setOemPartNumber(next.partNumbers[1] ?? "");
    setItemType(itemTypeOrDefault(next.itemType));
    setCondition(conditionFromHints(next.conditionHints));
    const taxonomy = taxonomies.find((entry) => entry.name.toLowerCase() === next.taxonomy.trim().toLowerCase());
    setTaxonomyId(taxonomy?.id ?? "");
    const lines = [
      ...next.specs.map((spec) => `${spec.name}: ${spec.value}`),
      next.rawText ? `Seen on the label: ${next.rawText}` : "",
    ].filter(Boolean);
    setDescription(lines.join("\n"));
  }

  async function openCreate() {
    setCreating(true);
    setMessage(null);
    if (sku) return;
    try {
      setSku(await reserveNewItemSku());
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function saveItem() {
    if (!name.trim() || !sku.trim()) {
      setMessage("Name and SKU are required.");
      return;
    }
    if (unresolved) {
      setMessage("Choose a manufacturer from the list, or clear the name.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const taxonomy = taxonomies.find((entry) => entry.id === taxonomyId) ?? null;
      const id = await createItem({
        name: name.trim(),
        sku: sku.trim(),
        description: description.trim(),
        quantity: null,
        taxonomyName: taxonomy?.name ?? null,
        attributes: attributesFor(taxonomy, reading),
        attributeDefs: (taxonomy?.attributes ?? []).map(definitionFor),
        longCode: taxonomy?.longCode ?? null,
        shortCode: taxonomy?.shortCode ?? null,
        manufacturerId,
        model: model.trim(),
        partNumber: partNumber.trim(),
        oemName: "",
        oemPartNumber: oemPartNumber.trim(),
        productUrl: "",
        unit: DEFAULT_UNIT,
        condition,
        conditionNote: "",
        eccn: DEFAULT_ECCN,
        usHts: "",
        ccats: "",
        coo: "",
        itemType,
      });
      await uploadItemImages(id, shots.map((shot) => shot.file));
      window.location.assign(`/items/${id}`);
    } catch (error) {
      setMessage(errorText(error));
      setBusy(false);
    }
  }

  async function attach(itemId: string) {
    setBusy(true);
    setMessage(null);
    try {
      await uploadItemImages(itemId, shots.map((shot) => shot.file));
      window.location.assign(`/items/${itemId}`);
    } catch (error) {
      setMessage(errorText(error));
      setBusy(false);
    }
  }

  return (
    <main className="page">
      {configured === false ? (
        <p className="banner error">Lens is not configured. Add GEMINI_API_KEY on the server, then reload this page.</p>
      ) : null}
      <section className="card">
        <div className="gallery-actions">
          <label className="button file-button">
            Take photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy || shots.length >= MAX_SHOTS}
              onChange={(event) => {
                void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <label className="button secondary file-button">
            Add images
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={busy || shots.length >= MAX_SHOTS}
              onChange={(event) => {
                void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <button type="button" disabled={busy || shots.length === 0 || configured === false} onClick={() => void identify()}>
            {busy ? "Reading…" : "Identify"}
          </button>
        </div>
        <p className="hint">Take up to four photos of the label, or add images from the phone. Photos are sent for identification and are not stored unless you attach them to an item.</p>
        {shots.length > 0 ? (
          <ul className="lens-shots">
            {shots.map((shot) => (
              <li key={shot.key}>
                <img src={shot.url} alt="" />
                <button type="button" className="secondary" disabled={busy} onClick={() => removeShot(shot.key)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {message ? <p className="hint error-text">{message}</p> : null}
      {reading ? (
        <section className="card">
          <h2>Reading</h2>
          <p>
            {[reading.manufacturer, reading.model, reading.partNumbers.join(", ")].filter(Boolean).join(" · ") || "No part number was readable."}
          </p>
          <p className="hint">
            Reading confidence {Math.round(reading.confidence * 100)}%.
            {reading.taxonomy ? ` Suggested taxonomy: ${reading.taxonomy}.` : ""}
            {reading.conditionHints ? ` Condition: ${reading.conditionHints}.` : ""}
          </p>
          {matches.length === 0 ? <p>No inventory item matched. You can create a new item from this reading.</p> : null}
          {matches.length > 0 ? (
            <ul className="lens-results">
              {matches.map((hit) => (
                <li key={hit.id}>
                  <div>
                    <Link href={`/items/${hit.id}`}>{hit.name || hit.sku}</Link>
                    <span className="muted">{hit.sku}</span>
                    <span>{Math.round(hit.confidence * 100)}%</span>
                    <span className="lens-qty">{hit.quantity === null ? "Qty —" : `Qty ${hit.quantity}`}</span>
                  </div>
                  <p className="hint">{hit.reasons.join(" · ")}</p>
                  <button type="button" className="secondary" disabled={busy} onClick={() => void attach(hit.id)}>
                    Add these photos to this item
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" disabled={busy} onClick={() => void openCreate()}>
            Create new item
          </button>
        </section>
      ) : null}
      {creating ? (
        <section className="card">
          <h2>New item</h2>
          <div className="grid">
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              SKU
              <input value={sku} onChange={(event) => setSku(event.target.value)} />
            </label>
            <label>
              Manufacturer
              <ManufacturerSelect
                manufacturerId={manufacturerId}
                manufacturerName={manufacturerName}
                onChange={(id, next) => {
                  setManufacturerId(id);
                  setManufacturerName(next);
                }}
                onUnresolved={onUnresolved}
              />
            </label>
            <label>
              Model
              <input value={model} onChange={(event) => setModel(event.target.value)} />
            </label>
            <label>
              Part number
              <input value={partNumber} onChange={(event) => setPartNumber(event.target.value)} />
            </label>
            <label>
              OEM part number
              <input value={oemPartNumber} onChange={(event) => setOemPartNumber(event.target.value)} />
            </label>
            <label>
              Taxonomy
              <select value={taxonomyId} onChange={(event) => setTaxonomyId(event.target.value)}>
                <option value="">None</option>
                {taxonomies.map((taxonomy) => (
                  <option key={taxonomy.id} value={taxonomy.id}>{taxonomy.name}</option>
                ))}
              </select>
            </label>
            <label>
              Item type
              <select value={itemType} onChange={(event) => setItemType(itemTypeOrDefault(event.target.value))}>
                {ITEM_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              Condition
              <select value={condition} onChange={(event) => setCondition(event.target.value === "New" ? "New" : "Used")}>
                <option value="Used">Used</option>
                <option value="New">New</option>
              </select>
            </label>
          </div>
          <label>
            Description
            <textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <button type="button" disabled={busy} onClick={() => void saveItem()}>
            Save item and attach photos
          </button>
        </section>
      ) : null}
    </main>
  );
}

function definitionFor(attribute: Taxonomy["attributes"][number]): AttributeDefinition {
  return {
    name: attribute.name,
    data_type: attribute.data_type,
    unit: attribute.unit,
    uses_list: attribute.uses_list,
  };
}

function attributesFor(taxonomy: Taxonomy | null, reading: LensReading | null): Record<string, string> {
  if (!taxonomy || !reading) return {};
  const attributes: Record<string, string> = {};
  const spec = reading.specCodes[0]?.trim();
  if (!spec) return attributes;
  const field = taxonomy.attributes.find((attribute) => attribute.name.trim().toLowerCase() === "spec code");
  if (!field) return attributes;
  if (field.uses_list && !field.allowedValues.some((value) => value.toLowerCase() === spec.toLowerCase())) return attributes;
  attributes[field.name] = spec;
  return attributes;
}

function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const data = result.replace(/^data:[^,]*,/, "");
      resolve(data);
    };
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.readAsDataURL(file);
  });
}
