"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { errorText } from "@/lib/errors";
import { createItem, fetchItem, fetchTaxonomies, updateItem } from "@/lib/items";
import type { Taxonomy } from "@/lib/types";

type ItemFormProps = {
  mode: "create" | "edit";
  itemId?: string;
};

function attributeLabel(name: string, unit: string | null): string {
  return unit ? `${name} (${unit})` : name;
}

export function ItemForm({ mode, itemId }: ItemFormProps) {
  const router = useRouter();
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([]);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [taxonomyId, setTaxonomyId] = useState("");
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>({});
  const [loadedAttributes, setLoadedAttributes] = useState<Record<string, string>>({});
  const [loadedTaxonomyId, setLoadedTaxonomyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [taxonomyRows, item] = await Promise.all([
          fetchTaxonomies(),
          mode === "edit" && itemId ? fetchItem(itemId) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setTaxonomies(taxonomyRows);
        if (mode === "edit") {
          if (!item) {
            setMissing(true);
            return;
          }
          setSku(item.sku);
          setName(item.name);
          setDescription(item.description);
          setQuantity(item.quantity === null ? "" : String(item.quantity));
          setTaxonomyId(item.taxonomyId ?? "");
          setLoadedTaxonomyId(item.taxonomyId);
          setLoadedAttributes(item.attributes);
          setAttributeValues(item.attributes);
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

  const taxonomy = useMemo(
    () => taxonomies.find((row) => row.id === taxonomyId) ?? null,
    [taxonomies, taxonomyId],
  );

  function onTaxonomyChange(nextId: string) {
    setTaxonomyId(nextId);
    setSaved(false);
    if (nextId && nextId === loadedTaxonomyId) {
      setAttributeValues(loadedAttributes);
      return;
    }
    setAttributeValues({});
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);

    const trimmedName = name.trim();
    const trimmedSku = sku.trim();
    if (!trimmedName) {
      setSaveError("Name is required.");
      return;
    }
    if (!trimmedSku) {
      setSaveError("SKU is required.");
      return;
    }
    if (mode === "create" && !taxonomy) {
      setSaveError("Choose a taxonomy.");
      return;
    }

    const quantityText = quantity.trim();
    const parsedQuantity = quantityText === "" ? null : Number(quantityText);
    if (parsedQuantity !== null && !Number.isFinite(parsedQuantity)) {
      setSaveError("Quantity must be a whole number.");
      return;
    }

    const attributes: Record<string, string> = {};
    for (const attribute of taxonomy?.attributes ?? []) {
      const value = (attributeValues[attribute.name] ?? "").trim();
      if (value) attributes[attribute.name] = value;
    }

    const input = {
      name: trimmedName,
      sku: trimmedSku,
      description: description.trim(),
      quantity: parsedQuantity,
      taxonomyName: taxonomy?.name ?? null,
      attributes,
    };

    setSaving(true);
    try {
      if (mode === "create") {
        const id = await createItem(input);
        router.push(`/items/${id}`);
        return;
      }
      if (!itemId) throw new Error("Missing item id.");
      await updateItem(itemId, input);
      setLoadedTaxonomyId(taxonomy?.id ?? null);
      setLoadedAttributes(attributes);
      setSaved(true);
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      setSaving(false);
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
        <Link href="/">Back to items</Link>
      </main>
    );
  }

  if (missing) {
    return (
      <main className="page">
        <h1>Item not found</h1>
        <p className="muted">That item is not in the inventory.</p>
        <Link href="/">Back to items</Link>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>{mode === "create" ? "New item" : "Edit item"}</h1>
        <Link className="button secondary" href="/">
          Back
        </Link>
      </div>
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
          <select
            value={taxonomyId}
            onChange={(event) => onTaxonomyChange(event.target.value)}
            required={mode === "create"}
          >
            <option value="">
              {mode === "create" ? "Select a taxonomy" : "No taxonomy"}
            </option>
            {taxonomies.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        {taxonomy ? (
          <fieldset>
            <legend>{taxonomy.name} attributes</legend>
            <div className="grid">
              {taxonomy.attributes.map((attribute) => {
                const numeric = attribute.data_type !== "text";
                return (
                  <label key={attribute.id}>
                    {attributeLabel(attribute.name, attribute.unit)}
                    <input
                      type={numeric ? "number" : "text"}
                      step={attribute.data_type === "decimal" ? "any" : numeric ? "1" : undefined}
                      inputMode={
                        attribute.data_type === "decimal"
                          ? "decimal"
                          : numeric
                            ? "numeric"
                            : undefined
                      }
                      value={attributeValues[attribute.name] ?? ""}
                      autoComplete="off"
                      onChange={(event) => {
                        const value = event.target.value;
                        setAttributeValues((current) => ({
                          ...current,
                          [attribute.name]: value,
                        }));
                        setSaved(false);
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        <div className="actions">
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create item" : "Save changes"}
          </button>
        </div>
      </form>
    </main>
  );
}
