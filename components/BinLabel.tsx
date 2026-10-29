"use client";

import JsBarcode from "jsbarcode";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
  BIN_BARCODE_HEIGHT_PX,
  BIN_BARCODE_MAX_MM,
  BIN_BARCODE_QUIET_MODULES,
  BIN_LABEL_BRAND,
  BIN_LABEL_HEIGHT_MM,
  BIN_LABEL_WIDTH_MM,
  PALLET_BARCODE_HEIGHT_MM,
  PALLET_BARCODE_MAX_MM,
  PALLET_BRAND_FONT_MM,
  PALLET_BRAND_LETTER_SPACING_EM,
  DK1202_PAGE_HEIGHT_MM,
  DK1202_PAGE_WIDTH_MM,
  PALLET_LABEL_HEIGHT_MM,
  PALLET_LABEL_PAD_BOTTOM_MM,
  PALLET_LABEL_PAD_TOP_MM,
  PALLET_LABEL_PAD_X_MM,
  PALLET_LABEL_WIDTH_MM,
  PALLET_STACK_GAP_MM,
  approxBoldWidthPx,
  binBarcodeLayout,
  binLabelAtPageMm,
  binLabelNamedPage,
  binLabelPage,
  fittedFontSize,
  mmToCssPx,
  palletQrSideMm,
  palletReferenceMaxFontMm,
  palletReferenceWidthMm,
  quietInsetRatio,
  scaledModuleWidth,
  type BinLabelSheet,
} from "@/lib/binLabelLayout";

type BinLabelProps = {
  reference: string;
  type: BinType;
  layout: LabelTemplateId;
  /**
   * The print job this label belongs to. A mixed job names the page when this
   * label's stock differs from the job's unnamed page. Omit it for a preview.
   */
  sheet?: BinLabelSheet;
};

function referenceWidthPx(text: string, fontPx: number): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return approxBoldWidthPx(text, fontPx);
  ctx.font = `700 ${fontPx}px Helvetica, Arial, sans-serif`;
  const width = ctx.measureText(text).width;
  return width > 0 ? width : approxBoldWidthPx(text, fontPx);
}

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

export function BinLabel({ reference, type, layout, sheet }: BinLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const refBox = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const pallet = binBarcodeLayout(type) === "mixed";
  const symbol = useMemo(
    () => (layout === "qr" ? qrPath(reference) : null),
    [layout, reference],
  );
  const qrSideMm = symbol ? palletQrSideMm(symbol.sideMm) : 0;
  const middleMm = layout === "qr" && symbol ? qrSideMm : PALLET_BARCODE_HEIGHT_MM;
  const [palletFontPx, setPalletFontPx] = useState(() => mmToCssPx(palletReferenceMaxFontMm(PALLET_BARCODE_HEIGHT_MM)));

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const line = lineRef.current;
    if (!svg || layout !== "barcode" || !reference) return;

    const maxMm = pallet ? PALLET_BARCODE_MAX_MM : BIN_BARCODE_MAX_MM;
    const barHeight = pallet ? mmToCssPx(PALLET_BARCODE_HEIGHT_MM) : BIN_BARCODE_HEIGHT_PX;

    const draw = (moduleWidth: number) => {
      const quietZone = Math.max(1, Math.round(moduleWidth * BIN_BARCODE_QUIET_MODULES));
      JsBarcode(svg, reference, {
        format: BIN_BARCODE_FORMAT,
        width: moduleWidth,
        height: barHeight,
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
    const target = mmToCssPx(maxMm);
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
  }, [layout, pallet, reference]);

  useLayoutEffect(() => {
    if (!pallet || !reference) return;
    const box = refBox.current;
    const measure = measureRef.current;
    const maxWidth = box && box.clientWidth > 0 ? box.clientWidth : mmToCssPx(palletReferenceWidthMm());
    const base = box && box.clientHeight > 0 ? box.clientHeight : mmToCssPx(palletReferenceMaxFontMm(middleMm));
    let textWidth = 0;
    if (measure && box && box.clientWidth > 0 && base > 0) {
      measure.style.fontSize = `${base}px`;
      textWidth = measure.scrollWidth;
    }
    if (!(textWidth > 0)) textWidth = referenceWidthPx(reference, base);
    const next = fittedFontSize({ textWidthPx: textWidth, maxWidthPx: maxWidth, basePx: base });
    setPalletFontPx((current) => (Math.abs(current - next) < 0.25 ? current : next));
  }, [middleMm, pallet, reference]);

  useLayoutEffect(() => {
    if (!pallet) return;
    const box = refBox.current;
    const text = textRef.current;
    if (!box || !text || box.clientWidth <= 0 || palletFontPx <= 0) return;
    if (text.scrollWidth <= box.clientWidth + 0.5) return;
    const next = (palletFontPx * box.clientWidth) / text.scrollWidth;
    setPalletFontPx((current) => (Math.abs(current - next) < 0.25 ? current : next));
  }, [pallet, palletFontPx, reference]);

  const caption = (
    <>
      <span className="bin-label-brand">{BIN_LABEL_BRAND}</span>
      <span className="bin-label-ref">{reference}</span>
    </>
  );
  const page = binLabelPage(type);
  const namedPage = sheet ? binLabelNamedPage(type, sheet) : null;
  const pageClass =
    namedPage === "bin-pallet" ? " bin-label-page-pallet" : namedPage === "bin-standard" ? " bin-label-page-standard" : "";

  return (
    <article
      className={`bin-label${pallet ? " bin-label-pallet" : ""}${layout === "qr" ? " bin-label-qr-layout" : ""}${pageClass}`}
      data-label-template={layout}
      data-bin-type={type}
      data-bin-reference={reference}
      data-bin-layout={binBarcodeLayout(type)}
      data-label-paper={page.paper}
      style={{ width: `${page.widthMm}mm`, height: `${page.heightMm}mm` }}
    >
      {pallet ? (
        <div className="bin-label-pallet-art">
          <div className="bin-label-pallet-brand">{BIN_LABEL_BRAND}</div>
          {layout === "qr" && symbol ? (
            <svg
              className="bin-label-qr"
              viewBox={`0 0 ${symbol.span} ${symbol.span}`}
              width={`${qrSideMm}mm`}
              height={`${qrSideMm}mm`}
              shapeRendering="crispEdges"
              role="img"
              aria-label={reference}
            >
              <path d={symbol.d} fill="#000000" />
            </svg>
          ) : (
            <svg ref={svgRef} className="bin-label-bars" role="img" aria-label={reference} />
          )}
          <div ref={refBox} className="bin-label-pallet-ref">
            <span ref={measureRef} className="bin-label-pallet-measure" aria-hidden="true">
              {reference}
            </span>
            <span ref={textRef} className="bin-label-pallet-text" style={{ fontSize: `${palletFontPx}px` }}>
              {reference}
            </span>
          </div>
        </div>
      ) : layout === "qr" && symbol ? (
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

export function binLabelPrintCss(sheet: BinLabelSheet): string {
  const page = binLabelAtPageMm(sheet);
  const bodyWidth = sheet.mode === "mixed" ? "auto" : `${page.widthMm}mm`;
  return `
@page {
  size: ${page.widthMm}mm ${page.heightMm}mm;
  margin: 0;
}

@page bin-standard {
  size: ${BIN_LABEL_WIDTH_MM}mm ${BIN_LABEL_HEIGHT_MM}mm;
  margin: 0;
}

@page bin-pallet {
  size: ${DK1202_PAGE_WIDTH_MM}mm ${DK1202_PAGE_HEIGHT_MM}mm;
  margin: 0;
}

.bin-label-page-standard {
  page: bin-standard;
}

.bin-label-page-pallet {
  page: bin-pallet;
}

.bin-label {
  width: ${BIN_LABEL_WIDTH_MM}mm;
  height: ${BIN_LABEL_HEIGHT_MM}mm;
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
  width: ${BIN_BARCODE_MAX_MM}mm;
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

.bin-label-pallet {
  width: ${PALLET_LABEL_WIDTH_MM}mm;
  height: ${PALLET_LABEL_HEIGHT_MM}mm;
  padding: ${PALLET_LABEL_PAD_TOP_MM}mm ${PALLET_LABEL_PAD_X_MM}mm ${PALLET_LABEL_PAD_BOTTOM_MM}mm;
  justify-content: flex-start;
  gap: ${PALLET_STACK_GAP_MM}mm;
}

/* Screen keeps the flex column on the label. Print turns this into the rotated art. */
.bin-label-pallet-art {
  display: contents;
}

.bin-label-pallet-brand {
  flex: 0 0 auto;
  align-self: stretch;
  font-size: ${PALLET_BRAND_FONT_MM}mm;
  font-weight: 700;
  line-height: 1;
  letter-spacing: ${PALLET_BRAND_LETTER_SPACING_EM}em;
  text-indent: ${PALLET_BRAND_LETTER_SPACING_EM}em;
  text-align: center;
  white-space: nowrap;
}

.bin-label-pallet .bin-label-bars {
  width: ${PALLET_BARCODE_MAX_MM}mm;
  max-width: 100%;
  height: ${PALLET_BARCODE_HEIGHT_MM}mm;
  flex: 0 0 auto;
}

.bin-label-pallet-ref {
  position: relative;
  flex: 1 1 auto;
  align-self: stretch;
  width: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  text-align: center;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bin-label-pallet-measure {
  position: absolute;
  left: 0;
  top: 0;
  visibility: hidden;
  white-space: nowrap;
  font: inherit;
  font-weight: 700;
  letter-spacing: inherit;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.bin-label-pallet-text {
  display: block;
  font: inherit;
  font-weight: 700;
  line-height: 1;
  letter-spacing: inherit;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.bin-label-qr-layout {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  column-gap: 2mm;
}

.bin-label-pallet.bin-label-qr-layout {
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  column-gap: 0;
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
  width: ${BIN_LABEL_WIDTH_MM}mm;
  border: 1px dashed #8a93a0;
  background: #fff;
}

.label-frame:has(.bin-label-pallet),
.label-frame.label-frame-pallet {
  width: ${PALLET_LABEL_WIDTH_MM}mm;
}

.print-sheet {
  display: none;
}

@media (max-width: 420px) {
  .bin-view .bin-head-label .label-frame:has(.bin-label-pallet),
  .bin-view .bin-head-label .label-frame.label-frame-pallet {
    width: ${PALLET_LABEL_WIDTH_MM}mm;
    transform-origin: top left;
    scale: min(1, calc(100cqi / ${PALLET_LABEL_WIDTH_MM}mm));
  }

  .bin-view .bin-head-label button.bin-label-hit:has(.bin-label-pallet),
  .bin-view .bin-head-label button.bin-label-hit.bin-label-hit-pallet {
    display: block;
    width: min(${PALLET_LABEL_WIDTH_MM}mm, 100%);
    height: calc((${PALLET_LABEL_HEIGHT_MM}mm + 2px) * min(1, 100cqi / ${PALLET_LABEL_WIDTH_MM}mm));
    overflow: hidden;
  }
}

@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    width: ${bodyWidth} !important;
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

  /* The driver page is 62 mm wide. The 100 mm art is rotated so it fills that page. */
  .bin-label-pallet {
    width: ${DK1202_PAGE_WIDTH_MM}mm !important;
    height: ${DK1202_PAGE_HEIGHT_MM}mm !important;
    padding: 0 !important;
    overflow: hidden !important;
    position: relative !important;
    display: block !important;
  }

  .bin-label-pallet-art {
    display: flex !important;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: ${PALLET_STACK_GAP_MM}mm;
    box-sizing: border-box;
    width: ${PALLET_LABEL_WIDTH_MM}mm;
    height: ${PALLET_LABEL_HEIGHT_MM}mm;
    padding: ${PALLET_LABEL_PAD_TOP_MM}mm ${PALLET_LABEL_PAD_X_MM}mm ${PALLET_LABEL_PAD_BOTTOM_MM}mm;
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: top left;
    transform: translateX(${DK1202_PAGE_WIDTH_MM}mm) rotate(90deg);
    background: #fff;
  }

  .print-sheet .bin-label:last-child {
    break-after: auto;
    page-break-after: auto;
  }
}
`;
}
