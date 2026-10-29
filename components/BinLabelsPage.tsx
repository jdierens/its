"use client";

import { FormEvent, useEffect, useState } from "react";
import { BinLabel, binLabelPrintCss } from "@/components/BinLabel";
import { errorText } from "@/lib/errors";
import {
  BIN_COPY_MAX,
  BIN_PRINT_MAX,
  BIN_TYPES,
  binCreatedLabel,
  binTypeLabel,
  formatBinReference,
  parseBinRange,
  parseBinReference,
  parsePrintCount,
  type BinRecord,
  type BinType,
} from "@/lib/bins";
import {
  fetchBinCounter,
  fetchRecentBins,
  printBinRange,
  reprintBin,
  reserveBins,
} from "@/lib/binActions";
import {
  binLabelTemplateLabel,
  emptyBinLabelTemplates,
  type BinLabelTemplates,
  type LabelTemplateId,
} from "@/lib/labelTemplates";
import { fetchBinLabelTemplates } from "@/lib/labelActions";
import { binLabelFrameClass, binLabelPage, binLabelSheet } from "@/lib/binLabelLayout";

type Batch = {
  labels: Array<{ reference: string; type: BinType }>;
  template: LabelTemplateId;
};

function TypeButtons({
  selected,
  onSelect,
  disabled,
  name,
}: {
  selected: BinType;
  onSelect: (type: BinType) => void;
  disabled: boolean;
  name: string;
}) {
  return (
    <div className="bin-types" role="group" aria-label={name}>
      {BIN_TYPES.map((type) => (
        <button
          key={type.id}
          type="button"
          aria-pressed={selected === type.id}
          disabled={disabled}
          onClick={() => onSelect(type.id)}
        >
          {type.label}
        </button>
      ))}
    </div>
  );
}

export function BinLabelsPage() {
  const [nextType, setNextType] = useState<BinType>("P");
  const [rangeType, setRangeType] = useState<BinType>("P");
  const [previewType, setPreviewType] = useState<BinType>("P");
  const [quantity, setQuantity] = useState("1");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [reference, setReference] = useState("");
  const [copiesText, setCopiesText] = useState("1");
  const [nextNumber, setNextNumber] = useState<number | null>(null);
  const [highestIssued, setHighestIssued] = useState<number | null>(null);
  const [recent, setRecent] = useState<BinRecord[]>([]);
  const [templates, setTemplates] = useState<BinLabelTemplates>(emptyBinLabelTemplates);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [printStamp, setPrintStamp] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const [counter, bins, labelTemplates] = await Promise.all([
      fetchBinCounter(),
      fetchRecentBins(),
      fetchBinLabelTemplates(),
    ]);
    setNextNumber(counter.nextNumber);
    setHighestIssued(counter.highestIssued);
    setRecent(bins);
    setTemplates(labelTemplates);
  }

  useEffect(() => {
    let cancelled = false;
    refresh()
      .catch((loadError: unknown) => {
        if (!cancelled) setError(errorText(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (printStamp === 0) return;
    window.print();
  }, [printStamp]);

  async function runPrint(action: () => Promise<{ batch: Batch; notice: string }>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      setBatch(result.batch);
      setNotice(result.notice);
      setPrintStamp((current) => current + 1);
      await refresh();
    } catch (actionError) {
      setError(errorText(actionError));
    } finally {
      setBusy(false);
    }
  }

  function onPrintNext(event: FormEvent) {
    event.preventDefault();
    const count = parsePrintCount(quantity, BIN_PRINT_MAX);
    if (count == null) {
      setError(`Quantity must be a whole number from 1 to ${BIN_PRINT_MAX}.`);
      setNotice(null);
      return;
    }
    const type = nextType;
    setPreviewType(type);
    void runPrint(async () => {
      const [bins, labelTemplates] = await Promise.all([
        reserveBins(type, count),
        fetchBinLabelTemplates(),
      ]);
      const first = bins[0]?.reference ?? "";
      const last = bins[bins.length - 1]?.reference ?? first;
      return {
        batch: {
          labels: bins.map((bin) => ({ reference: bin.reference, type: bin.type })),
          template: labelTemplates[type],
        },
        notice:
          bins.length === 1
            ? `Printed ${first}.`
            : `Printed ${first} through ${last}.`,
      };
    });
  }

  function onPrintRange(event: FormEvent) {
    event.preventDefault();
    const range = parseBinRange(fromText, toText);
    if (range == null) {
      setError(`Enter a from and to. From is at least 1, to is at least from, and the range is at most ${BIN_PRINT_MAX} labels.`);
      setNotice(null);
      return;
    }
    const type = rangeType;
    setPreviewType(type);
    void runPrint(async () => {
      const [bins, labelTemplates] = await Promise.all([
        printBinRange(type, range.from, range.to),
        fetchBinLabelTemplates(),
      ]);
      return {
        batch: {
          labels: bins.map((bin) => ({ reference: bin.reference, type: bin.type })),
          template: labelTemplates[type],
        },
        notice: `Printed ${formatBinReference(range.from, type)} through ${formatBinReference(range.to, type)}.`,
      };
    });
  }

  function onReprint(event: FormEvent) {
    event.preventDefault();
    const parsed = parseBinReference(reference);
    const copies = parsePrintCount(copiesText, BIN_COPY_MAX);
    if (!parsed) {
      setError("Enter a bin reference like 20000-P or 10001-C.");
      setNotice(null);
      return;
    }
    if (copies == null) {
      setError(`Copies must be a whole number from 1 to ${BIN_COPY_MAX}.`);
      setNotice(null);
      return;
    }
    setPreviewType(parsed.type);
    void runPrint(async () => {
      const [bin, labelTemplates] = await Promise.all([
        reprintBin(parsed.reference, copies),
        fetchBinLabelTemplates(),
      ]);
      return {
        batch: {
          labels: Array.from({ length: copies }, () => ({
            reference: bin.reference,
            type: bin.type,
          })),
          template: labelTemplates[bin.type],
        },
        notice:
          copies === 1
            ? `Reprinted ${bin.reference}.`
            : `Reprinted ${bin.reference}, ${copies} copies.`,
      };
    });
  }

  const previewNumber = nextNumber ?? 20000;
  const previewReference = formatBinReference(previewNumber, previewType);
  const previewTemplate = templates[previewType];
  const previewPage = binLabelPage(previewType);
  const sheet = binLabelSheet(batch ? batch.labels.map((label) => label.type) : [previewType]);

  return (
    <main className="page bin-desk">
      <style>{binLabelPrintCss(sheet)}</style>
      <div className="no-print">
        <p className="page-note">
          Print pallet, crate, and box labels. One shared number, so 20000-P, 20001-B, and 20002-C
          never share a number. Print next reserves the numbers. Staff do not pick them.
        </p>
        {loading ? <p className="muted">Loading bins…</p> : null}
        <div className="bin-status card">
          <div>
            <div className="muted">Next number</div>
            <strong>{nextNumber ?? "…"}</strong>
          </div>
          <div>
            <div className="muted">Last used</div>
            <strong>{highestIssued ?? "None"}</strong>
          </div>
        </div>

        <form onSubmit={onPrintNext}>
          <h2>Print next</h2>
          <TypeButtons
            name="Bin type for the next labels"
            selected={nextType}
            disabled={busy}
            onSelect={(type) => {
              setNextType(type);
              setPreviewType(type);
            }}
          />
          <label htmlFor="bin-quantity">
            Quantity
            <input
              id="bin-quantity"
              inputMode="numeric"
              autoComplete="off"
              value={quantity}
              disabled={busy}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <button className="bin-go" type="submit" disabled={busy || loading}>
            {busy ? "Working…" : "Print next"}
          </button>
        </form>

        <form onSubmit={onPrintRange}>
          <h2>Print a sequence</h2>
          <TypeButtons
            name="Bin type for the sequence"
            selected={rangeType}
            disabled={busy}
            onSelect={(type) => {
              setRangeType(type);
              setPreviewType(type);
            }}
          />
          <div className="grid">
            <label htmlFor="bin-from">
              From
              <input
                id="bin-from"
                inputMode="numeric"
                autoComplete="off"
                value={fromText}
                disabled={busy}
                onChange={(event) => setFromText(event.target.value)}
              />
            </label>
            <label htmlFor="bin-to">
              To
              <input
                id="bin-to"
                inputMode="numeric"
                autoComplete="off"
                value={toText}
                disabled={busy}
                onChange={(event) => setToText(event.target.value)}
              />
            </label>
          </div>
          <span className="hint">
            Prints one label for each number. A number that already belongs to another type is
            refused. If the range reaches the next number, the counter moves past it.
          </span>
          <button className="bin-go" type="submit" disabled={busy || loading}>
            Print sequence
          </button>
        </form>

        <form onSubmit={onReprint}>
          <h2>Reprint</h2>
          <label htmlFor="bin-reference">
            Bin reference
            <input
              id="bin-reference"
              list="bin-references"
              autoComplete="off"
              placeholder="20000-P"
              value={reference}
              disabled={busy}
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
          <datalist id="bin-references">
            {recent.map((bin) => (
              <option key={bin.id} value={bin.reference} />
            ))}
          </datalist>
          <label htmlFor="bin-copies">
            Copies
            <input
              id="bin-copies"
              inputMode="numeric"
              autoComplete="off"
              value={copiesText}
              disabled={busy}
              onChange={(event) => setCopiesText(event.target.value)}
            />
          </label>
          <span className="hint">
            Reprints do not move the counter. A typed 1xxxx label is stored the first time it is
            reprinted.
          </span>
          <button className="bin-go" type="submit" disabled={busy || loading}>
            Reprint
          </button>
        </form>

        {error ? (
          <p className="banner error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="banner ok" role="status">
            {notice}
          </p>
        ) : null}

        <div className="print-help">
          {previewType === "P" ? (
            <>
              <p>Brother QL-820NWB, DK-1202 die-cut labels. The dialog should already show:</p>
              <ul>
                <li>Paper size: 62 × 100 mm</li>
                <li>Scale: 100%</li>
                <li>Margins: None</li>
                <li>Headers and footers: off</li>
              </ul>
              <p>
                The Brother paper is 62 mm across the tape and 100 mm along the feed. The label art is
                turned onto that page, so leave orientation alone. Landscape clips the right side. Crate
                and box labels stay 29 × 90 mm, landscape. Print one type at a time. A batch that mixes
                pallets with crates or boxes uses a different page size per label; if the dialog offers
                only one paper size, split the batch.
              </p>
            </>
          ) : (
            <>
              <p>Brother QL-820NWB, DK-1201 die-cut labels. In the print dialog use:</p>
              <ul>
                <li>Paper size: 29 × 90 mm</li>
                <li>Orientation: Landscape</li>
                <li>Scale: 100%</li>
                <li>Margins: None</li>
                <li>Headers and footers: off</li>
              </ul>
            </>
          )}
        </div>

        <div className="label-preview">
          <p className="hint">
            Preview of the next {binTypeLabel(previewType).toLowerCase()} label, {previewReference},{" "}
            {previewPage.paper}. This number is not reserved. Layout: {binLabelTemplateLabel(previewTemplate)}.
            The barcode or QR code is the reference itself.
          </p>
          <div className={binLabelFrameClass(previewType)} data-bin-preview="next">
            <BinLabel reference={previewReference} type={previewType} layout={previewTemplate} />
          </div>
        </div>

        <div className="card">
          <table className="dense">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Type</th>
                <th>Created</th>
                <th>Created by</th>
                <th>Location</th>
                <th>Printed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={7}>No bins yet.</td>
                </tr>
              ) : (
                recent.map((bin) => (
                  <tr key={bin.id}>
                    <td className="sku">{bin.reference}</td>
                    <td>{binTypeLabel(bin.type)}</td>
                    <td>{binCreatedLabel(bin.createdAt)}</td>
                    <td>{bin.createdBy ?? ""}</td>
                    <td>{bin.currentLocationId ?? ""}</td>
                    <td className="sku">{bin.printedCount}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setReference(bin.reference);
                          setPreviewType(bin.type);
                        }}
                      >
                        Pick
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Created by and location stay blank until sign-in and locations exist.
        </p>
      </div>
      {batch ? (
        <div className="print-sheet">
          {batch.labels.map((label, index) => (
            <BinLabel
              key={`${label.reference}-${index}`}
              reference={label.reference}
              type={label.type}
              layout={batch.template}
              sheet={sheet}
            />
          ))}
        </div>
      ) : null}
    </main>
  );
}
