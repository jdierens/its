"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { PrintedLabel } from "@/components/labelRenderers";
import { barcodeValue, LABEL_PRINT_CSS } from "@/components/ItemLabel";
import { errorText } from "@/lib/errors";
import { findItemForLabel } from "@/lib/items";
import { fetchLabelTemplate } from "@/lib/labelActions";
import {
  labelTemplateLabel,
  labelTemplateOrDefault,
  qrLabelPayload,
  type LabelTemplateId,
} from "@/lib/labelTemplates";
import type { LabelItem } from "@/lib/types";

function todayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function LabelsPage() {
  const params = useSearchParams();
  const initialIdentifier = params.get("sku") ?? params.get("id") ?? "";
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [quantity, setQuantity] = useState("1");
  const [copiesText, setCopiesText] = useState("1");
  const [item, setItem] = useState<LabelItem | null>(null);
  const [printedOn, setPrintedOn] = useState(() => todayLabel(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [printStamp, setPrintStamp] = useState(0);
  const [template, setTemplate] = useState<LabelTemplateId | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (printStamp === 0) return;
    window.print();
  }, [printStamp]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLabelTemplate()
      .then((value) => {
        if (!cancelled) setTemplate(value);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTemplate(labelTemplateOrDefault(null));
        setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!initialIdentifier) return;
    let cancelled = false;
    setLoading(true);
    findItemForLabel(initialIdentifier)
      .then((found) => {
        if (cancelled) return;
        setItem(found);
        setPrintedOn(todayLabel(new Date()));
        if (!found) setError("No item matches that SKU or id.");
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
  }, [initialIdentifier]);

  const copies = useMemo(() => {
    const parsed = Number(copiesText);
    if (!Number.isInteger(parsed) || parsed < 1) return 0;
    return Math.min(parsed, 100);
  }, [copiesText]);

  async function onFind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setItem(null);
    const query = identifier.trim();
    if (!query) {
      setError("Enter a SKU or item id.");
      return;
    }
    const parsedQuantity = Number(quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 0) {
      setError("Quantity must be a whole number.");
      return;
    }
    const parsedCopies = Number(copiesText);
    if (!Number.isInteger(parsedCopies) || parsedCopies < 1 || parsedCopies > 100) {
      setError("Copies must be a whole number from 1 to 100.");
      return;
    }
    setLoading(true);
    try {
      const found = await findItemForLabel(query);
      if (!found) {
        setError("No item matches that SKU or id.");
        return;
      }
      setItem(found);
      setPrintedOn(todayLabel(new Date()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  const code = item ? barcodeValue(item.sku, item.id) : "";
  const labelQuantity = quantity.trim() || "0";
  const readyTemplate = template;
  const qrReady = readyTemplate !== "qr" || origin !== "";
  const payload =
    item && readyTemplate === "qr" && origin ? qrLabelPayload(origin, item.id, item.sku) : "";

  return (
    <main className="page">
      <style>{LABEL_PRINT_CSS}</style>
      <form className="no-print" onSubmit={onFind}>
        <p className="hint">
          The quantity is printed on the label. It does not change the item&apos;s stock.
        </p>
        <div className="grid">
          <label>
            SKU or item id
            <input
              value={identifier}
              autoComplete="off"
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </label>
          <label>
            Quantity on label
            <input
              type="number"
              min="0"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <label>
            Copies
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              value={copiesText}
              onChange={(event) => setCopiesText(event.target.value)}
            />
          </label>
        </div>
        <div className="actions">
          <button type="submit" disabled={loading}>
            {loading ? "Looking up…" : "Show label"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!item}
            onClick={() => {
              const parsedQuantity = Number(quantity);
              const parsedCopies = Number(copiesText);
              if (!Number.isInteger(parsedQuantity) || parsedQuantity < 0) {
                setError("Quantity must be a whole number.");
                return;
              }
              if (!Number.isInteger(parsedCopies) || parsedCopies < 1 || parsedCopies > 100) {
                setError("Copies must be a whole number from 1 to 100.");
                return;
              }
              setError(null);
              setPrintedOn(todayLabel(new Date()));
              setPrintStamp((current) => current + 1);
            }}
          >
            Print
          </button>
        </div>
        {error ? <p className="banner error">{error}</p> : null}
        <div className="print-help">
          <p>Brother QL-820NWB, DK-1201 die-cut labels, from a Mac browser. In the print dialog use:</p>
          <ul>
            <li>Paper size: 29 × 90 mm</li>
            <li>Orientation: Landscape</li>
            <li>Scale: 100%</li>
            <li>Margins: None</li>
            <li>Headers and footers: off</li>
          </ul>
          <p>Each copy is one 90 mm × 29 mm page. The preview below is the same size.</p>
        </div>
      </form>
      {item && readyTemplate && qrReady ? (
        <>
          <div className="no-print label-preview">
            <p className="hint">
              Preview for {item.sku || item.id}. {copies} {copies === 1 ? "copy" : "copies"} will print.
              Template: {labelTemplateLabel(readyTemplate)}.{" "}
              {readyTemplate === "qr" ? `QR code opens ${payload}.` : `Barcode encodes ${code}.`}
            </p>
            <div className="label-frame">
              <PrintedLabel
                template={readyTemplate}
                name={item.name}
                description={item.description}
                code={code}
                sku={item.sku}
                itemId={item.id}
                origin={origin}
                quantity={labelQuantity}
                shortCode={item.shortCode}
                printedOn={printedOn}
              />
            </div>
          </div>
          <div className="print-sheet">
            {Array.from({ length: Math.max(copies, 1) }, (_, index) => (
              <PrintedLabel
                key={`${item.id}-${readyTemplate}-${index}`}
                template={readyTemplate}
                name={item.name}
                description={item.description}
                code={code}
                sku={item.sku}
                itemId={item.id}
                origin={origin}
                quantity={labelQuantity}
                shortCode={item.shortCode}
                printedOn={printedOn}
              />
            ))}
          </div>
        </>
      ) : null}
    </main>
  );
}
