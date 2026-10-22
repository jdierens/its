"use client";

import JsBarcode from "jsbarcode";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { mmToCssPx } from "@/lib/binLabelLayout";
import {
  SERIAL_BARCODE_MAX_MM,
  SERIAL_HEAD_GAP_MM,
  SERIAL_HUMAN_FONT_MM,
  SERIAL_LABEL_HEIGHT_MM,
  SERIAL_LABEL_SHOW_QTY,
  SERIAL_LABEL_WIDTH_MM,
  serialBarcodePlan,
  serialHumanFontMm,
  serialLabelDescription,
  serialLabelHeadMode,
  serialLabelQtyText,
  type SerialHeadMode,
} from "@/lib/serialLabel";

export type SerialLabelCodeMarkSide = "left" | "right";

type SerialItemLabelProps = {
  sku: string;
  description: string;
  quantity: string;
  serial: string;
  /** Draws Qty N. Defaults to SERIAL_LABEL_SHOW_QTY so the whole label can turn it back on. */
  showQuantity?: boolean;
  /**
   * Later home for a QR of SKU|name|quantity|serial.
   * It sits on one side of the barcode. The human-readable serial stays under the bars.
   */
  codeMark?: ReactNode;
  codeMarkSide?: SerialLabelCodeMarkSide;
};

export function SerialItemLabel({
  sku,
  description,
  quantity,
  serial,
  showQuantity = SERIAL_LABEL_SHOW_QTY,
  codeMark,
  codeMarkSide = "right",
}: SerialItemLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const skuRef = useRef<HTMLDivElement>(null);
  const qtyRef = useRef<HTMLDivElement>(null);
  const humanMeasureRef = useRef<HTMLSpanElement>(null);
  const humanTextRef = useRef<HTMLSpanElement>(null);
  const shownSku = sku.trim() || "No SKU";
  const shownDescription = serialLabelDescription(description);
  const qtyText = serialLabelQtyText(quantity);
  const [headMode, setHeadMode] = useState<SerialHeadMode>("inline");
  const [humanFontMm, setHumanFontMm] = useState(SERIAL_HUMAN_FONT_MM);

  useLayoutEffect(() => {
    const head = headRef.current;
    const skuEl = skuRef.current;
    if (!head || !skuEl) return;
    const qtyEl = qtyRef.current;
    const next = serialLabelHeadMode({
      headPx: head.clientWidth,
      skuPx: skuEl.scrollWidth,
      qtyPx: showQuantity && qtyEl ? qtyEl.scrollWidth : 0,
      gapPx: mmToCssPx(SERIAL_HEAD_GAP_MM),
    });
    setHeadMode((current) => (current === next ? current : next));
  }, [shownSku, qtyText, shownDescription, showQuantity]);

  useLayoutEffect(() => {
    const measure = humanMeasureRef.current;
    const label = measure?.closest(".serial-label");
    if (!measure || !(label instanceof HTMLElement)) return;
    const pad = getComputedStyle(label);
    const max = label.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
    const next = serialHumanFontMm({
      textWidthPx: measure.scrollWidth,
      maxWidthPx: max,
      baseFontMm: SERIAL_HUMAN_FONT_MM,
    });
    setHumanFontMm((current) => (Math.abs(current - next) < 0.01 ? current : next));
  }, [serial]);

  useLayoutEffect(() => {
    const text = humanTextRef.current;
    const label = text?.closest(".serial-label");
    if (!text || !(label instanceof HTMLElement)) return;
    const pad = getComputedStyle(label);
    const max = label.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
    if (max <= 0 || text.scrollWidth <= max) return;
    const next = (humanFontMm * max) / text.scrollWidth;
    setHumanFontMm((current) => (Math.abs(current - next) < 0.01 ? current : next));
  }, [serial, humanFontMm]);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const column = columnRef.current;
    if (!svg || !column || !serial) return;
    const target = column.clientWidth || mmToCssPx(SERIAL_BARCODE_MAX_MM);
    const plan = serialBarcodePlan(serial, target);
    try {
      JsBarcode(svg, serial, {
        format: "CODE128",
        width: plan.modulePx,
        height: plan.heightPx,
        margin: 0,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: plan.quietPx,
        marginRight: plan.quietPx,
        displayValue: false,
        background: "#ffffff",
        lineColor: "#000000",
        flat: true,
      });
      svg.setAttribute("shape-rendering", "crispEdges");
    } catch {
      svg.replaceChildren();
    }
  }, [serial]);

  const mark = codeMark ? <div className="serial-label-mark">{codeMark}</div> : null;

  return (
    <article
      className="serial-label"
      data-serial={serial}
      data-qty={qtyText}
      data-sku={shownSku}
      data-head={headMode}
      style={{ width: `${SERIAL_LABEL_WIDTH_MM}mm`, height: `${SERIAL_LABEL_HEIGHT_MM}mm` }}
    >
      <div
        className={["serial-label-head", showQuantity ? "show-qty" : "", headMode === "stacked" ? "stacked" : ""]
          .filter(Boolean)
          .join(" ")}
        ref={headRef}
      >
        <div className="serial-label-sku" ref={skuRef}>
          {shownSku}
        </div>
        <div className="serial-label-desc">{shownDescription}</div>
        {showQuantity ? (
          <div className="serial-label-qty" ref={qtyRef}>
            {qtyText}
          </div>
        ) : null}
      </div>
      <div className="serial-label-code-row">
        {codeMarkSide === "left" ? mark : null}
        <div className="serial-label-bars-col" ref={columnRef}>
          <svg ref={svgRef} className="serial-label-bars" role="img" aria-label={`Code 128 barcode for ${serial}`} />
          <div className="serial-label-human">
            <span
              ref={humanMeasureRef}
              className="serial-label-human-measure"
              aria-hidden="true"
              style={{ fontSize: `${SERIAL_HUMAN_FONT_MM}mm` }}
            >
              {serial}
            </span>
            <span ref={humanTextRef} className="serial-label-human-text" style={{ fontSize: `${humanFontMm}mm` }}>
              {serial}
            </span>
          </div>
        </div>
        {codeMarkSide === "right" ? mark : null}
      </div>
    </article>
  );
}

export const SERIAL_LABEL_PRINT_CSS = `
@page {
  size: ${SERIAL_LABEL_WIDTH_MM}mm ${SERIAL_LABEL_HEIGHT_MM}mm;
  margin: 0;
}

.serial-label {
  width: ${SERIAL_LABEL_WIDTH_MM}mm;
  height: ${SERIAL_LABEL_HEIGHT_MM}mm;
  box-sizing: border-box;
  /* DK-1202 is 62 × 100 mm. The print head does not cover the last ~1.5 mm of the 62 mm tape.
     Those edges are the top and bottom of this landscape page. */
  padding: 2.2mm 3mm 2.6mm;
  display: flex;
  flex-direction: column;
  justify-content: center;
  /* Shorter bars leave more open tape. A wider gap keeps the head, the bars, and the serial apart. */
  gap: 3.6mm;
  overflow: hidden;
  background: #fff;
  color: #000;
  opacity: 1;
  font-family: Helvetica, Arial, sans-serif;
}

.serial-label-head {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: ${SERIAL_HEAD_GAP_MM}mm;
  row-gap: 1mm;
  align-items: start;
  width: 100%;
  min-width: 0;
}

.serial-label-head.show-qty {
  grid-template-columns: max-content minmax(0, 1fr) max-content;
}

.serial-label-sku {
  grid-column: 1;
  grid-row: 1;
  font-size: 4.4mm;
  font-weight: 700;
  line-height: 1.15;
  white-space: nowrap;
}

.serial-label-desc {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  font-size: 3.3mm;
  font-weight: 400;
  line-height: 1.2;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.serial-label-head.stacked .serial-label-desc {
  grid-column: 1 / -1;
  grid-row: 2;
}

.serial-label-qty {
  grid-column: 3;
  grid-row: 1;
  justify-self: end;
  font-size: 3.8mm;
  font-weight: 700;
  line-height: 1.15;
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.serial-label-code-row {
  flex: 0 0 auto;
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2mm;
}

.serial-label-bars-col {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2.2mm;
}

.serial-label-mark {
  flex: 0 0 auto;
}

.serial-label-bars {
  display: block;
  width: 100%;
  height: auto;
  shape-rendering: crispEdges;
}

.serial-label-human {
  position: relative;
  width: 100%;
  line-height: 1;
  text-align: center;
  overflow: visible;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.serial-label-human-measure {
  position: absolute;
  left: 0;
  top: 0;
  visibility: hidden;
  white-space: nowrap;
  font-weight: 700;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.serial-label-human-text {
  display: inline-block;
  max-width: 100%;
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.serial-frame {
  width: ${SERIAL_LABEL_WIDTH_MM}mm;
  border: 1px dashed #8a93a0;
  background: #fff;
}

.print-sheet {
  display: none;
}

@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    width: ${SERIAL_LABEL_WIDTH_MM}mm !important;
    height: auto !important;
  }

  .topbar,
  .sidebar,
  .shell-top,
  .shell-backdrop,
  .no-print {
    display: none !important;
  }

  .app-shell,
  .shell-body,
  .shell-content {
    display: block !important;
    width: auto !important;
    height: auto !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    overflow: visible !important;
    position: static !important;
  }

  .page {
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  .serial-frame {
    display: none !important;
  }

  .print-sheet {
    display: block;
    margin: 0;
    padding: 0;
  }

  .serial-label {
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
    page-break-inside: avoid;
    color: #000 !important;
    opacity: 1 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .print-sheet .serial-label:last-child {
    break-after: auto;
    page-break-after: auto;
  }
}
`;
