"use client";

import JsBarcode from "jsbarcode";
import { useEffect, useLayoutEffect, useRef } from "react";

type ItemLabelProps = {
  name: string;
  description: string;
  code: string;
  quantity: string;
  printedOn: string;
};

// 300 dpi dots are 3.125 CSS pixels (96 dpi). 1.28px is 4 dots, 0.96px is 3 dots.
// 32px is 100 dots, 8.47mm, above the 8mm scan floor.
const WIDE_MODULE_PX = 1.28;
const NARROW_MODULE_PX = 0.96;
const BAR_HEIGHT_PX = 32;
const MAX_BARCODE_MM = 46;
const CODE_CAP_TARGET_MM = 4;
// Label is 90mm with 1.5mm padding on each side. Leave 1px so the last glyph is not clipped.
const NAME_WIDTH_PX = ((90 - 1.5 - 1.5) * 96) / 25.4 - 1;
const NAME_MAX_FONT_PX = (3.4 * 96) / 25.4;
const NAME_MAX_CHARS = 60;

export function labelName(name: string): string {
  const value = name || "Untitled";
  if (value.length <= NAME_MAX_CHARS) return value;
  return `${value.slice(0, NAME_MAX_CHARS - 1)}…`;
}

function measuredWidth(text: string, fontSizePx: number, weight: number): number {
  const probe = document.createElement("span");
  probe.textContent = text;
  probe.style.position = "absolute";
  probe.style.left = "-9999px";
  probe.style.top = "0";
  probe.style.whiteSpace = "nowrap";
  probe.style.fontWeight = String(weight);
  probe.style.fontFamily = "Helvetica, Arial, sans-serif";
  probe.style.fontSize = `${fontSizePx}px`;
  probe.style.lineHeight = "1";
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

export function fitNameFontPx(text: string): number {
  const value = text || "Untitled";
  if (typeof document === "undefined") return NAME_MAX_FONT_PX;
  let low = 1;
  let high = NAME_MAX_FONT_PX;
  let best = low;
  for (let step = 0; step < 16; step += 1) {
    const mid = (low + high) / 2;
    if (measuredWidth(value, mid, 700) <= NAME_WIDTH_PX) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  return best;
}

function capHeightMm(fontSizePx: number): number {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return fontSizePx * 0.72 * (25.4 / 96);
  context.font = `700 ${fontSizePx}px Helvetica, Arial, sans-serif`;
  const metrics = context.measureText("0123456789");
  const ascent = metrics.actualBoundingBoxAscent || fontSizePx * 0.72;
  return (ascent * 25.4) / 96;
}

function fitCodeFontPx(text: string, maxWidthPx: number): number {
  if (typeof document === "undefined") return (CODE_CAP_TARGET_MM * 96) / 25.4;
  let low = 1;
  let high = 48;
  let best = low;
  for (let step = 0; step < 16; step += 1) {
    const mid = (low + high) / 2;
    const fitsWidth = measuredWidth(text, mid, 700) <= maxWidthPx - 1;
    const fitsCap = capHeightMm(mid) <= CODE_CAP_TARGET_MM + 0.02;
    if (fitsWidth && fitsCap) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  return best;
}

export function barcodeValue(sku: string, id: string): string {
  const trimmed = sku.trim();
  return trimmed || id;
}

export function ItemLabel({ name, description, code, quantity, printedOn }: ItemLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const descriptionSize = description.length > 90 ? "2mm" : "2.3mm";
  const displayName = labelName(name);

  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el) return;

    const fit = () => {
      const shown = labelName(el.dataset.fullName || el.textContent || displayName);
      el.textContent = shown;
      let size = fitNameFontPx(shown);
      el.style.fontSize = `${size}px`;
      if (el.clientWidth === 0) return;
      let guard = 0;
      while (el.scrollWidth > el.clientWidth && size > 1 && guard < 8) {
        size *= el.clientWidth / Math.max(el.scrollWidth, 1);
        el.style.fontSize = `${size}px`;
        guard += 1;
      }
    };

    fit();
    el.addEventListener("fit-name", fit);
    return () => el.removeEventListener("fit-name", fit);
  }, [displayName]);

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
    const drawn = parseFloat(svg.getAttribute("width") || "");
    const maxPx = (MAX_BARCODE_MM * 96) / 25.4;
    if (Number.isFinite(drawn) && drawn > maxPx) draw(NARROW_MODULE_PX);

    const codeEl = codeRef.current;
    const svgWidth = parseFloat(svg.getAttribute("width") || "");
    if (codeEl && Number.isFinite(svgWidth) && svgWidth > 0) {
      codeEl.style.fontSize = `${fitCodeFontPx(code, svgWidth)}px`;
    }
  }, [code]);

  return (
    <article className="item-label">
      <div
        ref={nameRef}
        className="item-label-name"
        data-full-name={name || "Untitled"}
        style={{ fontSize: `${NAME_MAX_FONT_PX}px` }}
      >
        {displayName}
      </div>
      <div className="item-label-desc" style={{ fontSize: descriptionSize }}>
        {description}
      </div>
      <div className="item-label-bottom">
        <div className="item-label-barcode">
          <svg ref={svgRef} role="img" aria-label={`Code 128 barcode for ${code}`} />
          <div ref={codeRef} className="item-label-code">
            {code}
          </div>
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
  overflow: visible;
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
  max-width: 46mm;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.item-label-barcode svg {
  display: block;
  shape-rendering: crispEdges;
}

.item-label-code {
  margin-top: 0.3mm;
  font-size: 5mm;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
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
