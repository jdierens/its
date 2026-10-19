"use client";

import JsBarcode from "jsbarcode";
import { useLayoutEffect, useRef } from "react";

type ItemLabelProps = {
  name: string;
  description: string;
  code: string;
  quantity: string;
  printedOn: string;
  shortCode?: string | null;
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

function widthWithSpacing(
  text: string,
  fontSizePx: number,
  weight: number,
  letterSpacingPx: number,
): number {
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
  probe.style.letterSpacing = `${letterSpacingPx}px`;
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

function fitCaptionToWidth(
  text: string,
  targetWidth: number,
): { fontPx: number; letterSpacingPx: number } {
  let fontPx = (2.6 * 96) / 25.4;
  if (targetWidth <= 0) return { fontPx, letterSpacingPx: 0 };
  let natural = measuredWidth(text, fontPx, 400);
  if (natural > targetWidth) {
    let low = 4;
    let high = fontPx;
    for (let step = 0; step < 14; step += 1) {
      const mid = (low + high) / 2;
      if (measuredWidth(text, mid, 400) <= targetWidth) {
        fontPx = mid;
        low = mid;
      } else {
        high = mid;
        fontPx = mid;
      }
    }
    natural = measuredWidth(text, fontPx, 400);
  }
  const gaps = Math.max(text.length - 1, 1);
  let letterSpacingPx = Math.max(0, targetWidth - natural) / gaps;
  const spaced = widthWithSpacing(text, fontPx, 400, letterSpacingPx);
  if (spaced > natural && Math.abs(spaced - targetWidth) > 0.4) {
    letterSpacingPx *= (targetWidth - natural) / (spaced - natural);
  }
  return { fontPx, letterSpacingPx };
}

function capTopGapPx(fontSizePx: number, weight: number): number {
  const probe = document.createElement("span");
  probe.textContent = "H";
  probe.style.position = "absolute";
  probe.style.left = "-9999px";
  probe.style.top = "0";
  probe.style.fontWeight = String(weight);
  probe.style.fontFamily = "Helvetica, Arial, sans-serif";
  probe.style.fontSize = `${fontSizePx}px`;
  probe.style.lineHeight = "1";
  const marker = document.createElement("span");
  marker.style.display = "inline-block";
  marker.style.width = "0";
  marker.style.height = "0";
  probe.appendChild(marker);
  document.body.appendChild(probe);
  const baselineFromTop = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return 0;
  context.font = `${weight} ${fontSizePx}px Helvetica, Arial, sans-serif`;
  const ascent = context.measureText("H8").actualBoundingBoxAscent || 0;
  return baselineFromTop - ascent;
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

export function ItemLabel({
  name,
  description,
  code,
  quantity,
  printedOn,
  shortCode,
}: ItemLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const shortRef = useRef<HTMLDivElement>(null);
  const qtyRef = useRef<HTMLElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const shownShortCode = shortCode?.trim().toUpperCase() || null;
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

  useLayoutEffect(() => {
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
      codeEl.style.width = `${svgWidth}px`;
    }

    const qtyEl = qtyRef.current;
    const shortEl = shortRef.current;
    const dateEl = dateRef.current;
    const captionEl = captionRef.current;
    const bigPx = (8.4 * 96) / 25.4;
    let shortPx = bigPx;
    let qtyPx = bigPx;
    if (shownShortCode) {
      const innerPx = ((90 - 3) * 96) / 25.4;
      const gapPx = (2 * 96) / 25.4;
      const barsPx = Number.isFinite(svgWidth) ? svgWidth : 0;
      let shortWidth = measuredWidth(shownShortCode, shortPx, 700);
      let qtyWidth = measuredWidth(quantity || "0", qtyPx, 700);
      const available = innerPx - barsPx - gapPx * 2;
      if (available > 0 && shortWidth + qtyWidth > available) {
        const scale = available / (shortWidth + qtyWidth);
        shortPx = Math.max(12, shortPx * scale);
        qtyPx = Math.max(12, qtyPx * scale);
        shortWidth = measuredWidth(shownShortCode, shortPx, 700);
      }
      if (shortEl) {
        shortEl.style.fontSize = `${shortPx}px`;
        shortEl.style.width = `${shortWidth}px`;
        shortEl.style.transform = `translateY(${-capTopGapPx(shortPx, 700)}px)`;
      }
      if (dateEl) {
        const fitted = fitCaptionToWidth(printedOn, shortWidth);
        dateEl.style.fontSize = `${fitted.fontPx}px`;
        dateEl.style.letterSpacing = `${fitted.letterSpacingPx}px`;
        dateEl.style.width = `${shortWidth}px`;
        if (captionEl) captionEl.style.fontSize = `${fitted.fontPx}px`;
      }
    } else if (dateEl) {
      const captionPx = (2.6 * 96) / 25.4;
      const dateWidth = measuredWidth(printedOn, captionPx, 400);
      dateEl.style.fontSize = "";
      dateEl.style.letterSpacing = "0px";
      dateEl.style.width = `${dateWidth}px`;
      if (shortEl) {
        shortEl.style.width = `${dateWidth}px`;
        shortEl.style.transform = "";
      }
      if (captionEl) captionEl.style.fontSize = "";
    }
    if (qtyEl) {
      qtyEl.style.fontSize = `${qtyPx}px`;
      qtyEl.style.transform = `translateY(${-capTopGapPx(qtyPx, 700)}px)`;
    }
  }, [code, shownShortCode, quantity, printedOn]);

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
        <div className="item-label-values">
          <svg
            ref={svgRef}
            className="item-label-bars"
            role="img"
            aria-label={`Code 128 barcode for ${code}`}
          />
          <strong ref={qtyRef} className="item-label-qty">
            {quantity}
          </strong>
          <div
            ref={shortRef}
            className="item-label-short"
            data-short-code={shownShortCode ?? ""}
          >
            {shownShortCode}
          </div>
        </div>
        <div className="item-label-captions">
          <div ref={codeRef} className="item-label-code">
            {code}
          </div>
          <div ref={captionRef} className="item-label-caption">
            QTY
          </div>
          <div ref={dateRef} className="item-label-date">
            {printedOn}
          </div>
        </div>
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
  flex-direction: column;
  row-gap: 0.45mm;
  min-height: 11mm;
}

.item-label-values,
.item-label-captions {
  display: flex;
  column-gap: 2mm;
}

.item-label-values {
  align-items: flex-start;
}

.item-label-captions {
  align-items: baseline;
}

.item-label-bars {
  flex: 0 0 auto;
  display: block;
  max-width: 46mm;
  shape-rendering: crispEdges;
}

.item-label-qty,
.item-label-caption {
  flex: 1 1 auto;
  text-align: center;
}

.item-label-qty {
  font-size: 8.4mm;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.item-label-short,
.item-label-date {
  flex: 0 0 auto;
  text-align: left;
  white-space: nowrap;
}

.item-label-short {
  font-size: 8.4mm;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
}

.item-label-code {
  flex: 0 0 auto;
  font-size: 5mm;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.item-label-caption,
.item-label-date {
  font-size: 2.6mm;
  font-weight: 400;
  line-height: 1;
}

.label-frame {
  width: 90mm;
  border: 1px dashed #8a93a0;
  background: #fff;
}

.item-label-qr {
  flex-direction: row;
  justify-content: flex-start;
  align-items: stretch;
  column-gap: 2mm;
}

.qr-col {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  height: 100%;
  max-width: 46mm;
}

.qr-symbol {
  display: block;
  flex: 0 0 auto;
  margin-bottom: 0.6mm;
  shape-rendering: crispEdges;
}

.qr-symbol-pending {
  width: 19.05mm;
  height: 19.05mm;
}

.qr-sku {
  font-weight: 700;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
  max-width: 100%;
}

.qr-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
}

.qr-name {
  font-weight: 700;
  line-height: 1.15;
  text-align: left;
  overflow-wrap: break-word;
}

.qr-facts {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  column-gap: 2mm;
}

.qr-fact-qty {
  flex: 1 1 auto;
  min-width: 0;
  text-align: center;
}

.qr-fact-code {
  flex: 0 0 auto;
  text-align: left;
}

.qr-big {
  font-size: 12mm;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.qr-cap,
.qr-date {
  font-size: 3.8mm;
  font-weight: 400;
  line-height: 1;
  white-space: nowrap;
}

.qr-fact-qty .qr-big,
.qr-fact-qty .qr-cap {
  text-align: center;
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
