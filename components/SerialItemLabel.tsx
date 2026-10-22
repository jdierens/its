"use client";

import JsBarcode from "jsbarcode";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { mmToCssPx } from "@/lib/binLabelLayout";
import {
  SERIAL_BARCODE_MAX_MM,
  SERIAL_HEAD_GAP_MM,
  SERIAL_LABEL_HEIGHT_MM,
  SERIAL_LABEL_WIDTH_MM,
  serialBarcodePlan,
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
  codeMark,
  codeMarkSide = "right",
}: SerialItemLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const skuRef = useRef<HTMLDivElement>(null);
  const qtyRef = useRef<HTMLDivElement>(null);
  const shownSku = sku.trim() || "No SKU";
  const shownDescription = serialLabelDescription(description);
  const qtyText = serialLabelQtyText(quantity);
  const [headMode, setHeadMode] = useState<SerialHeadMode>("inline");

  useLayoutEffect(() => {
    const head = headRef.current;
    const skuEl = skuRef.current;
    const qtyEl = qtyRef.current;
    if (!head || !skuEl || !qtyEl) return;
    const next = serialLabelHeadMode({
      headPx: head.clientWidth,
      skuPx: skuEl.scrollWidth,
      qtyPx: qtyEl.scrollWidth,
      gapPx: mmToCssPx(SERIAL_HEAD_GAP_MM),
    });
    setHeadMode((current) => (current === next ? current : next));
  }, [shownSku, qtyText, shownDescription]);

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
      <div className={headMode === "stacked" ? "serial-label-head stacked" : "serial-label-head"} ref={headRef}>
        <div className="serial-label-sku" ref={skuRef}>
          {shownSku}
        </div>
        <div className="serial-label-desc">{shownDescription}</div>
        <div className="serial-label-qty" ref={qtyRef}>
          {qtyText}
        </div>
      </div>
      <div className="serial-label-code-row">
        {codeMarkSide === "left" ? mark : null}
        <div className="serial-label-bars-col" ref={columnRef}>
          <svg ref={svgRef} className="serial-label-bars" role="img" aria-label={`Code 128 barcode for ${serial}`} />
          <div className="serial-label-human">{serial}</div>
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
  /* The QL-820NWB print head does not cover the last ~1.5 mm of a 62 mm tape.
     Those edges are the top and bottom of this landscape page. */
  padding: 2.2mm 3mm 2.6mm;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2.4mm;
  overflow: hidden;
  background: #fff;
  color: #000;
  opacity: 1;
  font-family: Helvetica, Arial, sans-serif;
}

.serial-label-head {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  column-gap: ${SERIAL_HEAD_GAP_MM}mm;
  row-gap: 1mm;
  align-items: start;
  width: 100%;
  min-width: 0;
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
  gap: 1.4mm;
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
  width: 100%;
  font-size: 4mm;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
