"use client";

import JsBarcode from "jsbarcode";
import { useEffect, useRef } from "react";

type ItemLabelProps = {
  name: string;
  description: string;
  code: string;
  quantity: string;
  printedOn: string;
};

// 300 dpi dots are 3.125 CSS pixels (96 dpi). 1.28px is 4 dots, 0.96px is 3 dots.
const WIDE_MODULE_PX = 1.28;
const NARROW_MODULE_PX = 0.96;
const BAR_HEIGHT_PX = 38.4;
const MAX_BARCODE_MM = 48;

export function barcodeValue(sku: string, id: string): string {
  const trimmed = sku.trim();
  return trimmed || id;
}

export function ItemLabel({ name, description, code, quantity, printedOn }: ItemLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nameSize = `${Math.min(3.4, Math.max(1.9, 150 / Math.max(name.length, 1)))}mm`;
  const descriptionSize = description.length > 90 ? "2mm" : "2.3mm";

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !code) return;

    const draw = (moduleWidth: number) => {
      const quietZone = Math.round(moduleWidth * 10);
      JsBarcode(svg, code, {
        format: "CODE128",
        width: moduleWidth,
        height: BAR_HEIGHT_PX,
        margin: 0,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: quietZone,
        marginRight: quietZone,
        displayValue: false,
        background: "#ffffff",
        lineColor: "#000000",
        flat: true,
      });
      svg.setAttribute("shape-rendering", "crispEdges");
    };

    draw(WIDE_MODULE_PX);
    const drawn = Number(svg.getAttribute("width"));
    const maxPx = (MAX_BARCODE_MM * 96) / 25.4;
    if (Number.isFinite(drawn) && drawn > maxPx) draw(NARROW_MODULE_PX);
  }, [code]);

  return (
    <article className="item-label">
      <div className="item-label-name" style={{ fontSize: nameSize }}>
        {name || "Untitled"}
      </div>
      <div className="item-label-desc" style={{ fontSize: descriptionSize }}>
        {description}
      </div>
      <div className="item-label-bottom">
        <div className="item-label-barcode">
          <svg ref={svgRef} role="img" aria-label={`Code 128 barcode for ${code}`} />
        </div>
        <div className="item-label-qty">
          <span>Qty</span>
          <strong>{quantity}</strong>
        </div>
        <div className="item-label-date">{printedOn}</div>
      </div>
    </article>
  );
}

export const LABEL_PRINT_CSS = `
@page {
  size: 90mm 29mm;
  margin: 0;
}

.item-label {
  width: 90mm;
  height: 29mm;
  box-sizing: border-box;
  padding: 1.5mm;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  background: #fff;
  color: #000;
  font-family: Helvetica, Arial, sans-serif;
}

.item-label-name {
  font-weight: 700;
  line-height: 1.05;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-label-desc {
  line-height: 1.15;
  text-align: center;
  max-height: 5.2mm;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.item-label-bottom {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2mm;
  min-height: 11mm;
}

.item-label-barcode {
  flex: 0 1 auto;
  max-width: 48mm;
  overflow: hidden;
}

.item-label-barcode svg {
  display: block;
  shape-rendering: crispEdges;
}

.item-label-qty {
  flex: 1;
  text-align: center;
}

.item-label-qty span {
  display: block;
  font-size: 2mm;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.item-label-qty strong {
  font-size: 4.2mm;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.item-label-date {
  font-size: 2.6mm;
  text-align: right;
  white-space: nowrap;
}

.label-frame {
  width: 90mm;
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
    width: 90mm !important;
    height: auto !important;
  }

  .topbar,
  .no-print {
    display: none !important;
  }

  .page {
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  .label-frame {
    display: none !important;
  }

  .print-sheet {
    display: block;
    margin: 0;
    padding: 0;
  }

  .item-label {
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
    page-break-inside: avoid;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .print-sheet .item-label:last-child {
    break-after: auto;
    page-break-after: auto;
  }
}
`;
