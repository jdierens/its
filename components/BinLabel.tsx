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
import { binTypeWord, type BinType } from "@/lib/bins";

type BinLabelProps = {
  reference: string;
  type: BinType;
  layout: LabelTemplateId;
};

const WIDE_MODULE_PX = 1.28;
const NARROW_MODULE_PX = 0.96;
const BAR_HEIGHT_PX = 30;
const MAX_BARCODE_MM = 84;

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
  const word = binTypeWord(type);
  const symbol = useMemo(
    () => (layout === "qr" ? qrPath(reference) : null),
    [layout, reference],
  );
  const pallet = type === "P";

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || layout !== "barcode" || !reference) return;

    const draw = (moduleWidth: number) => {
      const quietZone = Math.round(moduleWidth * 10);
      JsBarcode(svg, reference, {
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
    const maxPx = (MAX_BARCODE_MM * 96) / 25.4;
    const drawn = parseFloat(svg.getAttribute("width") || "");
    if (Number.isFinite(drawn) && drawn > maxPx) draw(NARROW_MODULE_PX);
  }, [layout, reference]);

  return (
    <article
      className={`bin-label${pallet ? " bin-label-pallet" : ""}${layout === "qr" ? " bin-label-qr-layout" : ""}`}
      data-label-template={layout}
      data-bin-type={type}
      data-bin-reference={reference}
    >
      <div className="bin-label-copy">
        <div className="bin-label-word">{word}</div>
        {pallet ? <div className="bin-label-mark" /> : null}
        <div className="bin-label-ref">{reference}</div>
      </div>
      {layout === "qr" && symbol ? (
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
      ) : (
        <svg ref={svgRef} className="bin-label-bars" role="img" aria-label={reference} />
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
  padding: 1.8mm 1.5mm 2.6mm;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
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

.bin-label-copy {
  min-width: 0;
}

.bin-label-word {
  font-size: 4.4mm;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1;
}

.bin-label-pallet .bin-label-word {
  font-size: 5.2mm;
  letter-spacing: 0.12em;
}

.bin-label-mark {
  width: 22mm;
  height: 0.8mm;
  margin-top: 0.45mm;
  background: #000;
}

.bin-label-ref {
  margin-top: 0.7mm;
  font-size: 8.2mm;
  font-weight: 700;
  line-height: 0.95;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bin-label-pallet .bin-label-ref {
  font-size: 9mm;
}

.bin-label-bars {
  display: block;
  width: auto;
  max-width: 100%;
  height: 8mm;
}

.bin-label-qr-layout {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  column-gap: 2mm;
}

.bin-label-qr-layout .bin-label-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
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

  .bin-label-mark,
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
