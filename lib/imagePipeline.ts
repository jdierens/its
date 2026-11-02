import type { ImageProcessingStatus } from "@/lib/types";
import type { PixelRect } from "@/lib/photoEdit";

/** Matches `REMOVED_ALPHA_THRESHOLD` in the editor. Near-transparent crumbs are not the subject. */
export const SUBJECT_ALPHA_MIN = 24;

/** A removed background that leaves almost nothing is discarded so the product photo is kept. */
export const MIN_SUBJECT_FRACTION = 0.02;

/** Working size for detection and background removal. Matches the upload compress edge. */
export const PROCESS_LONG_SIDE = 2000;

/** A tab that closed mid-pipeline can be claimed again after this long. */
export const PROCESSING_STALE_MS = 15 * 60 * 1000;

const SERIAL_LABEL =
  /\b(?:s\/n|s\.?n|serial(?:\s*(?:no\.?|number|#))?|imei|meid|uuid|service\s*tag|asset(?:\s*(?:tag|no\.?|#))?|mac(?:\s*address)?)\b/i;

export type CodeKind = "barcode" | "qr";

export type ImageProcessClaim = {
  itemId: string;
  imageId: string;
  storagePath: string;
  signedUrl: string;
  startedAt: string;
};

export type OcrWord = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type OcrLine = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  words: OcrWord[];
};

/** True when the processing columns are not in the database yet. Other errors stay errors. */
export function imageProcessingColumnMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!/processing_status|original_storage_path|processed_at|processing_error|processing_started_at/i.test(message)) {
    return false;
  }
  if (error.code === "PGRST204" || error.code === "42703") return true;
  return /schema cache|does not exist|could not find/i.test(message);
}

export function imageProcessingStatus(value: unknown): ImageProcessingStatus {
  if (value === "pending" || value === "processing" || value === "ready" || value === "failed") return value;
  return "ready";
}

export function processingClaimIsStale(
  status: ImageProcessingStatus,
  startedAt: string | null,
  now: number,
  staleMs = PROCESSING_STALE_MS,
): boolean {
  if (status === "pending" || status === "failed") return true;
  if (status !== "processing") return false;
  if (!startedAt) return true;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return true;
  return now - started >= staleMs;
}

export function storagePathsForImage(paths: {
  storagePath?: string | null;
  originalStoragePath?: string | null;
}): string[] {
  const unique = new Set<string>();
  for (const path of [paths.storagePath, paths.originalStoragePath]) {
    const trimmed = path?.trim();
    if (trimmed) unique.add(trimmed);
  }
  return [...unique];
}

export function processedImagePath(itemId: string, imageId: string, suffix: string): string {
  const safe = suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  if (!safe) throw new Error("Could not name the processed photo.");
  return `${itemId}/${imageId}.processed-${safe}.jpg`;
}

export function isProcessedImagePath(itemId: string, imageId: string, path: string): boolean {
  const prefix = `${itemId}/${imageId}.processed-`;
  if (!path.startsWith(prefix) || !path.endsWith(".jpg")) return false;
  const suffix = path.slice(prefix.length, -".jpg".length);
  return /^[a-z0-9]+$/.test(suffix);
}

export function normalizeIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isUniqueIdentifierToken(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true;
  if (/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(text)) return true;
  const compact = text.replace(/[\s:.-]/g, "");
  if (/^\d{15}$/.test(compact)) return true;
  if (/^\d{10,}$/.test(compact)) return true;
  return false;
}

export function lineHasSerialLabel(line: string): boolean {
  return SERIAL_LABEL.test(line);
}

/** A value printed under a serial label, not a short capacity or a word. */
export function looksLikeCodeValue(text: string): boolean {
  const compact = normalizeIdentifier(text);
  return compact.length >= 6 && /\d/.test(compact);
}

export function clampPixelRect(rect: PixelRect, width: number, height: number): PixelRect | null {
  if (width < 2 || height < 2) return null;
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(width, Math.ceil(rect.x + rect.w));
  const bottom = Math.min(height, Math.ceil(rect.y + rect.h));
  const w = right - x;
  const h = bottom - y;
  if (w < 2 || h < 2) return null;
  return { x, y, w, h };
}

/**
 * Pad a detected code so the bars and the human-readable line under a 1D symbol are unreadable.
 * Two scan-line endpoints have almost no height, so those grow into a barcode-shaped box first.
 */
export function padCodeBox(
  box: PixelRect,
  kind: CodeKind,
  imageWidth: number,
  imageHeight: number,
): PixelRect | null {
  let x = box.x;
  let y = box.y;
  let w = Math.max(1, box.w);
  let h = Math.max(0, box.h);
  if (kind === "barcode" && h < Math.max(12, w * 0.18)) {
    const target = Math.max(w * 0.32, 28);
    y -= (target - h) / 2;
    h = target;
  }
  if (kind === "qr") {
    const pad = Math.max(8, Math.max(w, h) * 0.08);
    return clampPixelRect({ x: x - pad, y: y - pad, w: w + pad * 2, h: h + pad * 2 }, imageWidth, imageHeight);
  }
  const padX = Math.max(10, w * 0.06);
  const padY = Math.max(18, h * 0.7);
  return clampPixelRect(
    { x: x - padX, y: y - padY * 0.35, w: w + padX * 2, h: h + padY },
    imageWidth,
    imageHeight,
  );
}

export function boxFromPoints(
  points: readonly { x: number; y: number }[],
  kind: CodeKind,
  imageWidth: number,
  imageHeight: number,
): PixelRect | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return padCodeBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, kind, imageWidth, imageHeight);
}

function unionWords(words: readonly OcrWord[]): PixelRect | null {
  if (words.length === 0) return null;
  let minX = words[0].x;
  let minY = words[0].y;
  let maxX = words[0].x + words[0].w;
  let maxY = words[0].y + words[0].h;
  for (const word of words) {
    minX = Math.min(minX, word.x);
    minY = Math.min(minY, word.y);
    maxX = Math.max(maxX, word.x + word.w);
    maxY = Math.max(maxY, word.y + word.h);
  }
  return { x: minX - 4, y: minY - 4, w: maxX - minX + 8, h: maxY - minY + 8 };
}

function lineRect(line: OcrLine): PixelRect | null {
  if (line.w > 2 && line.h > 2) return { x: line.x - 3, y: line.y - 3, w: line.w + 6, h: line.h + 6 };
  return unionWords(line.words);
}

function payloadHit(text: string, codes: readonly string[]): boolean {
  const compact = normalizeIdentifier(text);
  if (compact.length < 6) return false;
  return codes.some((code) => {
    if (compact === code) return true;
    const shorter = compact.length < code.length ? compact : code;
    const longer = compact.length < code.length ? code : compact;
    return longer.includes(shorter) && shorter.length >= 8 && shorter.length >= longer.length * 0.75;
  });
}

/**
 * Regions whose pixels should be destroyed.
 * A serial label blurs that line, or the next line when the value is on its own.
 * IMEI, MAC, UUID, long digit strings, and the text of a decoded barcode or QR code are blurred.
 * Part numbers without a serial label stay readable.
 */
export function identifierBoxes(
  lines: readonly OcrLine[],
  payloads: readonly string[],
  imageWidth: number,
  imageHeight: number,
): PixelRect[] {
  const codes = payloads.map(normalizeIdentifier).filter((value) => value.length >= 6);
  const boxes: PixelRect[] = [];
  let labelCarry = false;
  for (const line of lines) {
    const label = lineHasSerialLabel(line.text);
    const values = line.words.filter((word) => looksLikeCodeValue(word.text) || isUniqueIdentifierToken(word.text));
    if (label && values.length === 0 && !/\d/.test(line.text)) {
      labelCarry = true;
      continue;
    }
    if (label || (labelCarry && values.length > 0)) {
      labelCarry = false;
      const rect = lineRect(line);
      const clamped = rect ? clampPixelRect(rect, imageWidth, imageHeight) : null;
      if (clamped) boxes.push(clamped);
      continue;
    }
    labelCarry = false;
    for (const word of line.words) {
      if (!isUniqueIdentifierToken(word.text) && !payloadHit(word.text, codes)) continue;
      const clamped = clampPixelRect(
        { x: word.x - 3, y: word.y - 3, w: word.w + 6, h: word.h + 6 },
        imageWidth,
        imageHeight,
      );
      if (clamped) boxes.push(clamped);
    }
  }
  return boxes;
}

export function opaqueFraction(data: Uint8ClampedArray, alphaMin = SUBJECT_ALPHA_MIN): number {
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return 0;
  let opaque = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] >= alphaMin) opaque += 1;
  }
  return opaque / pixels;
}

/** Bounds of the visible subject after background removal, with a little padding. Null when the crop would be the whole frame. */
export function subjectBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaMin = SUBJECT_ALPHA_MIN,
): PixelRect | null {
  if (width < 2 || height < 2 || data.length < width * height * 4) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha < alphaMin) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const pad = Math.max(8, Math.round(Math.max(width, height) * 0.03));
  const rect = clampPixelRect(
    { x: minX - pad, y: minY - pad, w: maxX - minX + 1 + pad * 2, h: maxY - minY + 1 + pad * 2 },
    width,
    height,
  );
  if (!rect) return null;
  if (rect.w >= width * 0.98 && rect.h >= height * 0.98) return null;
  return rect;
}
