"use client";

import JsBarcode from "jsbarcode";
import { useLayoutEffect, useMemo, useRef } from "react";
import QRCode from "qrcode";
import {
  QR_ERROR_CORRECTION,
  QR_MODULE_MM,
  QR_QUIET_MODULES,
  qrSymbolMm,
  type LabelTemplateId,
} from "@/lib/labelTemplates";
import type { BinType } from "@/lib/bins";
import {
  BIN_BARCODE_FORMAT,
  BIN_BARCODE_MAX_MM,
  BIN_BARCODE_QUIET_MODULES,
  BIN_LABEL_BRAND,
  mmToCssPx,
  quietInsetRatio,
  scaledModuleWidth,
} from "@/lib/binLabelLayout";

type BinLabelProps = {
  reference: string;
  type: BinType;
  layout: LabelTemplateId;
};

const BAR_HEIGHT_PX = 50;

function qrPath(text: string): { d: string; span: number; sideMm: number } | null {
  if (!text) return null;
  let symbol;
  try {
    symbol = QRCode.create(text, { errorCorrectionLevel: QR_ERROR_CORRECTION });
  } catch {
    return null;
  }
  const size = symbol.modules.size;
  const span = size + QR_QUIET_MODULES * 2;
  let d = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (symbol.modules.get(row, col)) {
        const x = col + QR_QUIET_MODULES;
        const y = row + QR_QUIET_MODULES;
        d += `M${x} ${y}h1v1h-1z`;
      }
    }
  }
  return { d, span, sideMm: qrSymbolMm(size) };
}

export function BinLabel({ reference, type, layout }: BinLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const symbol = useMemo(
    () => (layout === "qr" ? qrPath(reference) : null),
    [layout, reference],
  );

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const line = lineRef.current;
    if (!svg || layout !== "barcode" || !reference) return;

    const draw = (moduleWidth: number) => {
      const quietZone = Math.max(1, Math.round(moduleWidth * BIN_BARCODE_QUIET_MODULES));
      JsBarcode(svg, reference, {
        format: BIN_BARCODE_FORMAT,
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
      return quietZone;
    };

    draw(1);
    const unit = parseFloat(svg.getAttribute("width") || "");
    const target = mmToCssPx(BIN_BARCODE_MAX_MM);
    let moduleWidth = scaledModuleWidth(unit, target);
    let quiet = draw(moduleWidth);
    let drawn = parseFloat(svg.getAttribute("width") || "");
    if (Number.isFinite(drawn) && drawn > target + 1) {
      moduleWidth = scaledModuleWidth(drawn, target) * moduleWidth;
      quiet = draw(moduleWidth);
      drawn = parseFloat(svg.getAttribute("width") || "");
    }
    if (line) {
      const inset = `${quietInsetRatio(drawn, quiet) * 100}%`;
      line.style.paddingLeft = inset;
      line.style.paddingRight = inset;
    }
  }, [layout, reference]);

  const caption = (
    <>
      <span className="bin-label-brand">{BIN_LABEL_BRAND}</span>
      <span className="bin-label-ref">{reference}</span>
    </>
  );

  return (
    <article
      className={`bin-label${layout === "qr" ? " bin-label-qr-layout" : ""}`}
      data-label-template={layout}
      data-bin-type={type}
      data-bin-reference={reference}
    >
      {layout === "qr" && symbol ? (
        <>
          <div className="bin-label-copy">{caption}</div>
          <svg
            className="bin-label-qr"
            viewBox={`0 0 ${symbol.span} ${symbol.span}`}
            width={`${symbol.sideMm}mm`}
            height={`${symbol.sideMm}mm`}
            shapeRendering="crispEdges"
            role="img"
            aria-label={reference}
          >
            <path d={symbol.d} fill="#000000" />
          </svg>
        </>
      ) : (
        <div className="bin-label-stack">
          <svg ref={svgRef} className="bin-label-bars" role="img" aria-label={reference} />
          <div ref={lineRef} className="bin-label-line">
            {caption}
          </div>
        </div>
      )}
    </article>
  );
}

export const BIN_LABEL_MODULE_MM = QR_MODULE_MM;

export const BIN_LABEL_PRINT_CSS = `
@page {
  size: 90mm 29mm;
  margin: 0;
}

.bin-label {
  width: 90mm;
  height: 29mm;
  box-sizing: border-box;
  padding: 1.6mm 3mm 1.8mm;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #fff;
  color: #000;
  opacity: 1;
  font-family: Helvetica, Arial, sans-serif;
}

.bin-label,
.bin-label * {
  color: #000;
  opacity: 1;
}

.bin-label-stack {
  width: 84mm;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 1.3mm;
}

.bin-label-line,
.bin-label-copy {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 3mm;
  min-width: 0;
  box-sizing: border-box;
  font-size: 8.6mm;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.03em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bin-label-brand,
.bin-label-ref {
  font: inherit;
  letter-spacing: inherit;
}

.bin-label-bars {
  display: block;
  width: 100%;
  height: auto;
}

.bin-label-qr-layout {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  column-gap: 2mm;
}

.bin-label-qr-layout .bin-label-copy {
  flex: 1 1 auto;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 1.2mm;
  font-size: 6.2mm;
}

.bin-label-qr {
  display: block;
  flex: 0 0 auto;
  shape-rendering: crispEdges;
}

.bin-label-qr path {
  fill: #000;
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

  .label-frame {
    display: none !important;
  }

  .print-sheet {
    display: block;
    margin: 0;
    padding: 0;
  }

  .bin-label,
  .bin-label * {
    color: #000 !important;
    opacity: 1 !important;
  }

  .bin-label-qr path {
    background: #000 !important;
    fill: #000 !important;
  }

  .bin-label {
    break-after: page;
    page-break-after: always;
    break-inside: avoid;
    page-break-inside: avoid;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .print-sheet .bin-label:last-child {
    break-after: auto;
    page-break-after: auto;
  }
}
`;
