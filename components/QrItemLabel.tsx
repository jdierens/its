"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import QRCode from "qrcode";
import {
  QR_ERROR_CORRECTION,
  QR_MODULE_MM,
  QR_QUIET_MODULES,
  qrLabelPayload,
  qrSymbolMm,
} from "@/lib/labelTemplates";

type QrItemLabelProps = {
  name: string;
  sku: string;
  itemId: string;
  origin: string;
  quantity: string;
  printedOn: string;
  shortCode?: string | null;
};

const NAME_MAX_MM = 4.53;
const NAME_MIN_MM = 2.2;
const NAME_LINE_HEIGHT = 1.15;
const BIG_MM = 12;
const CAPTION_MM = 3.8;
const CAPTION_MIN_MM = 2.8;
const BREATH_MM = 2.8;
const SKU_GAP_MM = 0.6;
const SKU_CAP_MM = 4;

function mmPx(mm: number): number {
  return (mm * 96) / 25.4;
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

function capHeightMm(fontSizePx: number): number {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return fontSizePx * 0.72 * (25.4 / 96);
  context.font = `700 ${fontSizePx}px Helvetica, Arial, sans-serif`;
  const metrics = context.measureText("0123456789");
  const ascent = metrics.actualBoundingBoxAscent || fontSizePx * 0.72;
  return (ascent * 25.4) / 96;
}

function fitSkuFontPx(text: string, maxWidthPx: number): number {
  let low = 1;
  let high = mmPx(9);
  let best = low;
  for (let step = 0; step < 16; step += 1) {
    const mid = (low + high) / 2;
    const fitsWidth = measuredWidth(text, mid, 700) <= maxWidthPx - 1;
    const fitsCap = capHeightMm(mid) <= SKU_CAP_MM + 0.02;
    if (fitsWidth && fitsCap) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  return best;
}

function inkGaps(text: string, fontSizePx: number, weight: number, element: HTMLElement) {
  const marker = document.createElement("span");
  marker.style.display = "inline-block";
  marker.style.width = "0";
  marker.style.height = "0";
  element.appendChild(marker);
  const box = element.getBoundingClientRect();
  const mark = marker.getBoundingClientRect();
  marker.remove();
  const baselineFromTop = mark.top - box.top;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const fallbackAscent = fontSizePx * 0.72;
  const fallbackDescent = fontSizePx * 0.05;
  if (!context) {
    return {
      top: baselineFromTop - fallbackAscent,
      bottom: box.height - baselineFromTop - fallbackDescent,
    };
  }
  context.font = `${weight} ${fontSizePx}px Helvetica, Arial, sans-serif`;
  const metrics = context.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || fallbackAscent;
  const descent = metrics.actualBoundingBoxDescent || 0;
  return {
    top: baselineFromTop - ascent,
    bottom: box.height - baselineFromTop - descent,
  };
}

function nameParts(name: string): Array<{ text: string; breakAfter: boolean }> {
  const value = name || "Untitled";
  const parts: Array<{ text: string; breakAfter: boolean }> = [];
  let buf = "";
  for (const ch of value) {
    buf += ch;
    if (ch === "\\" || ch === "/" || ch === " ") {
      parts.push({ text: buf, breakAfter: true });
      buf = "";
    }
  }
  if (buf) parts.push({ text: buf, breakAfter: false });
  if (parts.length === 0) parts.push({ text: "Untitled", breakAfter: false });
  return parts;
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

export function QrItemLabel({
  name,
  sku,
  itemId,
  origin,
  quantity,
  printedOn,
  shortCode,
}: QrItemLabelProps) {
  const nameRef = useRef<HTMLDivElement>(null);
  const skuRef = useRef<HTMLDivElement>(null);
  const symbolRef = useRef<SVGSVGElement>(null);
  const qtyRef = useRef<HTMLDivElement>(null);
  const shortRef = useRef<HTMLDivElement>(null);
  const qtyCaptionRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const shownShortCode = shortCode?.trim().toUpperCase() || "";
  const displayName = name || "Untitled";
  const shownSku = sku.trim() || itemId;
  const payload = origin ? qrLabelPayload(origin, itemId, sku) : "";
  const symbol = useMemo(() => qrPath(payload), [payload]);
  const parts = useMemo(() => nameParts(displayName), [displayName]);

  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    const max = mmPx(NAME_MAX_MM);
    const min = mmPx(NAME_MIN_MM);
    const fits = (size: number) => {
      el.style.fontSize = `${size}px`;
      return el.scrollHeight <= size * NAME_LINE_HEIGHT * 2 + 1;
    };
    if (fits(max)) return;
    let low = min;
    let high = max;
    let best = min;
    for (let step = 0; step < 12; step += 1) {
      const mid = (low + high) / 2;
      if (fits(mid)) {
        best = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    el.style.fontSize = `${best}px`;
  }, [displayName]);

  useLayoutEffect(() => {
    const skuEl = skuRef.current;
    const symbolEl = symbolRef.current;
    const qtyEl = qtyRef.current;
    const shortEl = shortRef.current;
    const qtyCaptionEl = qtyCaptionRef.current;
    const dateEl = dateRef.current;
    if (!skuEl || !qtyEl || !qtyCaptionEl || !dateEl) return;

    const symbolWidth = symbolEl?.getBoundingClientRect().width || mmPx(symbol?.sideMm ?? 19.05);
    const skuFont = fitSkuFontPx(shownSku, symbolWidth);
    skuEl.style.fontSize = `${skuFont}px`;
    skuEl.style.transform = "";
    if (symbolEl) symbolEl.style.marginBottom = `${mmPx(SKU_GAP_MM)}px`;

    const copyWidth = qtyEl.parentElement?.parentElement?.clientWidth ?? 0;
    const gapPx = mmPx(2);
    let bigPx = mmPx(BIG_MM);
    const qtyText = quantity || "0";
    if (shownShortCode && copyWidth > 0) {
      const qtyWidth = measuredWidth(qtyText, bigPx, 700);
      const shortWidth = measuredWidth(shownShortCode, bigPx, 700);
      if (qtyWidth + shortWidth + gapPx > copyWidth) {
        bigPx = Math.max(mmPx(6), bigPx * ((copyWidth - gapPx) / (qtyWidth + shortWidth)));
      }
    }
    qtyEl.style.fontSize = `${bigPx}px`;
    if (shortEl) shortEl.style.fontSize = `${bigPx}px`;

    let captionPx = mmPx(CAPTION_MM);
    const codeWidth = shownShortCode ? measuredWidth(shownShortCode, bigPx, 700) : 0;
    if (shownShortCode && codeWidth > 0 && measuredWidth(printedOn, captionPx, 700) > codeWidth) {
      let low = mmPx(CAPTION_MIN_MM);
      let high = captionPx;
      for (let step = 0; step < 12; step += 1) {
        const mid = (low + high) / 2;
        if (measuredWidth(printedOn, mid, 700) <= codeWidth) {
          captionPx = mid;
          low = mid;
        } else {
          high = mid;
          captionPx = mid;
        }
      }
    }
    qtyCaptionEl.style.fontSize = `${captionPx}px`;
    dateEl.style.fontSize = `${captionPx}px`;
    dateEl.style.letterSpacing = "0px";
    dateEl.style.width = "";
    if (shownShortCode && codeWidth > 0) {
      const natural = measuredWidth(printedOn, captionPx, 700);
      const gaps = Math.max(printedOn.length - 1, 1);
      let spacing = Math.max(0, codeWidth - natural) / gaps;
      const spaced = widthWithSpacing(printedOn, captionPx, 700, spacing);
      if (spaced > natural && Math.abs(spaced - codeWidth) > 0.4) {
        spacing *= (codeWidth - natural) / (spaced - natural);
      }
      dateEl.style.letterSpacing = `${spacing}px`;
      dateEl.style.width = `${codeWidth}px`;
      if (shortEl) shortEl.style.width = `${codeWidth}px`;
    }

    const bigGaps = inkGaps(qtyText, bigPx, 700, qtyEl);
    const capGaps = inkGaps("QTY", captionPx, 700, qtyCaptionEl);
    const margin = mmPx(BREATH_MM) - bigGaps.bottom - capGaps.top;
    qtyCaptionEl.style.marginTop = `${margin}px`;
    dateEl.style.marginTop = `${margin}px`;

    const skuMark = document.createElement("span");
    skuMark.style.display = "inline-block";
    skuMark.style.width = "0";
    skuMark.style.height = "0";
    skuEl.appendChild(skuMark);
    const dateMark = document.createElement("span");
    dateMark.style.display = "inline-block";
    dateMark.style.width = "0";
    dateMark.style.height = "0";
    dateEl.appendChild(dateMark);
    const skuBaseline = skuMark.getBoundingClientRect().top;
    const dateBaseline = dateMark.getBoundingClientRect().top;
    skuMark.remove();
    dateMark.remove();
    const shift = dateBaseline - skuBaseline;
    const appliedShift = Number.isFinite(shift) && Math.abs(shift) > 0.2 ? shift : 0;
    if (appliedShift !== 0) skuEl.style.transform = `translateY(${appliedShift}px)`;
    if (symbolEl) {
      const skuGaps = inkGaps(shownSku, skuFont, 700, skuEl);
      // The line box has empty space above the glyphs. Pull the symbol down
      // so 0.6 mm remains between the symbol edge and the SKU ink.
      symbolEl.style.marginBottom = `${mmPx(SKU_GAP_MM) - Math.max(0, skuGaps.top) - appliedShift}px`;
    }
  }, [shownSku, quantity, shownShortCode, printedOn, symbol]);

  return (
    <article className="item-label item-label-qr" data-label-template="qr">
      <div className="qr-col">
        {symbol ? (
          <svg
            ref={symbolRef}
            className="qr-symbol"
            viewBox={`0 0 ${symbol.span} ${symbol.span}`}
            width={`${symbol.sideMm}mm`}
            height={`${symbol.sideMm}mm`}
            role="img"
            aria-label={`QR code for ${payload}`}
            shapeRendering="crispEdges"
          >
            <path d={symbol.d} fill="#000" />
          </svg>
        ) : (
          <div className="qr-symbol qr-symbol-pending" aria-hidden="true" />
        )}
        <div ref={skuRef} className="qr-sku">
          {shownSku}
        </div>
      </div>
      <div className="qr-copy">
        <div ref={nameRef} className="qr-name" style={{ fontSize: `${mmPx(NAME_MAX_MM)}px` }}>
          {parts.map((part, index) => (
            <span key={`${part.text}-${index}`}>
              {part.text}
              {part.breakAfter ? <wbr /> : null}
            </span>
          ))}
        </div>
        <div className="qr-facts">
          <div className="qr-fact qr-fact-qty">
            <div ref={qtyRef} className="qr-big">
              {quantity || "0"}
            </div>
            <div ref={qtyCaptionRef} className="qr-cap">
              QTY
            </div>
          </div>
          <div className="qr-fact qr-fact-code">
            <div ref={shortRef} className="qr-big">
              {shownShortCode}
            </div>
            <div ref={dateRef} className="qr-date">
              {printedOn}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
