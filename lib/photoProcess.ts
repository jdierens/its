import { errorText } from "@/lib/errors";
import {
  PROCESS_LONG_SIDE,
  SUBJECT_ALPHA_MIN,
  MIN_SUBJECT_FRACTION,
  boxFromPoints,
  identifierBoxes,
  lineHasSerialLabel,
  opaqueFraction,
  subjectBounds,
  type CodeKind,
  type ImageProcessClaim,
  type OcrLine,
} from "@/lib/imagePipeline";
import {
  claimItemImageProcessing,
  failItemImageProcessing,
} from "@/lib/images";
import { uploadProcessedItemImage } from "@/lib/imageUpload";
import {
  autoImproveCanvas,
  canvasFromBlob,
  cleanRemovedAlpha,
  cropCanvas,
  exportForListing,
  flattenOnWhite,
  limitLongSide,
  redactRect,
  type PixelRect,
} from "@/lib/photoEdit";
import type { ItemImage } from "@/lib/types";

/**
 * Post-upload processing runs in the browser, after the gallery row is saved.
 * The background-removal model and English OCR weights are large WASM downloads.
 * They already fit the photo editor, and they do not fit a short Vercel function
 * or a Supabase Edge Function reliably. BarcodeDetector covers Android Chrome.
 * ZXing covers the other browsers. The upload itself does not wait for this work.
 */

const DOWNLOAD_MS = 45_000;
const DETECTOR_FORMATS = [
  "qr_code",
  "aztec",
  "data_matrix",
  "pdf417",
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "ean_13",
  "ean_8",
  "itf",
  "upc_a",
  "upc_e",
];

type FoundCode = { text: string; box: PixelRect | null };

let tail: Promise<void> = Promise.resolve();
let ocrWorker: Promise<{ recognize: Recognize; terminate: () => Promise<unknown> }> | null = null;

type Recognize = (
  image: HTMLCanvasElement,
  options: Record<string, never>,
  output: { blocks: boolean; text: boolean; hocr: boolean; tsv: boolean },
) => Promise<{ data: { lines?: OcrPageLine[] } }>;

type OcrPageLine = {
  text?: string;
  confidence?: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words?: {
    text?: string;
    confidence?: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }[];
};

function shortError(error: unknown): string {
  const text = errorText(error).replace(/\s+/g, " ").trim();
  return text.slice(0, 280) || "Photo processing failed.";
}

function detectorKind(format: string): CodeKind {
  const name = format.toLowerCase().replace(/[\s_-]/g, "");
  if (name.includes("qr") || name === "datamatrix" || name === "aztec") return "qr";
  return "barcode";
}

function fillWhite(data: Uint8ClampedArray, width: number, rect: PixelRect): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
  const height = Math.floor(data.length / 4 / width);
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = 255;
    }
  }
}

async function detectorCodes(canvas: HTMLCanvasElement): Promise<FoundCode[]> {
  const Detector = (window as Window & {
    BarcodeDetector?: {
      getSupportedFormats?: () => Promise<string[]>;
      new (options?: { formats?: string[] }): {
        detect: (source: ImageBitmap) => Promise<{
          rawValue?: string;
          format?: string;
          boundingBox?: { x: number; y: number; width: number; height: number };
          cornerPoints?: { x: number; y: number }[];
        }[]>;
      };
    };
  }).BarcodeDetector;
  if (!Detector) return [];
  let formats = DETECTOR_FORMATS;
  try {
    const supported = (await Detector.getSupportedFormats?.()) ?? [];
    if (supported.length > 0) formats = DETECTOR_FORMATS.filter((format) => supported.includes(format));
  } catch {
    formats = DETECTOR_FORMATS;
  }
  if (formats.length === 0) return [];
  const bitmap = await createImageBitmap(canvas);
  try {
    const detector = new Detector({ formats });
    const found = await detector.detect(bitmap);
    return found.flatMap((code) => {
      const text = code.rawValue?.trim() ?? "";
      const kind = detectorKind(code.format ?? "");
      const box = code.boundingBox
        ? boxFromPoints(
            code.cornerPoints?.length
              ? code.cornerPoints
              : [
                  { x: code.boundingBox.x, y: code.boundingBox.y },
                  { x: code.boundingBox.x + code.boundingBox.width, y: code.boundingBox.y + code.boundingBox.height },
                ],
            kind,
            canvas.width,
            canvas.height,
          )
        : null;
      return text || box ? [{ text, box }] : [];
    });
  } catch {
    return [];
  } finally {
    bitmap.close();
  }
}

async function zxingCodes(canvas: HTMLCanvasElement): Promise<FoundCode[]> {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = new Uint8ClampedArray(source.data);
  const {
    BarcodeFormat,
    BinaryBitmap,
    DecodeHintType,
    HybridBinarizer,
    MultiFormatReader,
    NotFoundException,
    RGBLuminanceSource,
  } = await import("@zxing/library");
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  const hits: FoundCode[] = [];
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const luminance = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
      luminance[pixel] = (data[index] + 2 * data[index + 1] + data[index + 2]) >> 2;
    }
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, canvas.width, canvas.height)));
    let result;
    try {
      result = new MultiFormatReader().decode(bitmap, hints);
    } catch (error) {
      if (error instanceof NotFoundException) break;
      break;
    }
    const text = result.getText()?.trim() ?? "";
    if (!text || seen.has(text)) break;
    seen.add(text);
    const format = result.getBarcodeFormat();
    const kind: CodeKind =
      format === BarcodeFormat.QR_CODE ||
      format === BarcodeFormat.DATA_MATRIX ||
      format === BarcodeFormat.AZTEC ||
      format === BarcodeFormat.MICRO_QR_CODE
        ? "qr"
        : "barcode";
    const points = (result.getResultPoints() ?? [])
      .filter((point) => point && Number.isFinite(point.getX()) && Number.isFinite(point.getY()))
      .map((point) => ({ x: point.getX(), y: point.getY() }));
    const box = boxFromPoints(points, kind, canvas.width, canvas.height);
    hits.push({ text, box });
    if (!box) break;
    fillWhite(data, canvas.width, box);
  }
  return hits;
}

async function readCodes(canvas: HTMLCanvasElement): Promise<FoundCode[]> {
  const [detected, decoded] = await Promise.all([
    detectorCodes(canvas).catch(() => [] as FoundCode[]),
    zxingCodes(canvas).catch(() => [] as FoundCode[]),
  ]);
  return [...detected, ...decoded];
}

function pageLines(lines: OcrPageLine[] | undefined): OcrLine[] {
  return (lines ?? []).flatMap((line) => {
    const text = line.text ?? "";
    if ((line.confidence ?? 100) < 30 && !lineHasSerialLabel(text)) return [];
    const words = (line.words ?? []).flatMap((word) => {
      const value = word.text ?? "";
      if (!value.trim()) return [];
      if ((word.confidence ?? 0) < 45 && !lineHasSerialLabel(text)) return [];
      return [
        {
          text: value,
          x: word.bbox.x0,
          y: word.bbox.y0,
          w: word.bbox.x1 - word.bbox.x0,
          h: word.bbox.y1 - word.bbox.y0,
        },
      ];
    });
    return [
      {
        text,
        x: line.bbox.x0,
        y: line.bbox.y0,
        w: line.bbox.x1 - line.bbox.x0,
        h: line.bbox.y1 - line.bbox.y0,
        words,
      },
    ];
  });
}

async function recognizeLines(canvas: HTMLCanvasElement): Promise<OcrLine[]> {
  try {
    if (!ocrWorker) {
      const { createWorker, OEM } = await import("tesseract.js");
      ocrWorker = createWorker("eng", OEM.LSTM_ONLY, { logger: () => undefined });
    }
    const worker = await ocrWorker;
    const result = await worker.recognize(canvas, {}, { blocks: true, text: false, hocr: false, tsv: false });
    return pageLines(result.data.lines);
  } catch {
    const pending = ocrWorker;
    ocrWorker = null;
    if (pending) pending.then((worker) => worker.terminate()).catch(() => undefined);
    return [];
  }
}

async function findIdentifierRegions(canvas: HTMLCanvasElement): Promise<PixelRect[]> {
  const [codes, lines] = await Promise.all([readCodes(canvas), recognizeLines(canvas)]);
  const boxes = codes.flatMap((code) => (code.box ? [code.box] : []));
  boxes.push(...identifierBoxes(lines, codes.map((code) => code.text), canvas.width, canvas.height));
  return boxes;
}

async function removeBackgroundCanvas(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const source = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not read the photo."));
    }, "image/png");
  });
  const { removeBackground } = await import("@imgly/background-removal");
  const removed = await removeBackground(source, { model: "isnet_quint8", device: "cpu" });
  return canvasFromBlob(removed);
}

async function downloadOriginal(url: string): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("Could not download the photo.");
    return await response.blob();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("The photo download timed out. Try again.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function runPipeline(claim: ImageProcessClaim): Promise<void> {
  const original = await downloadOriginal(claim.signedUrl);
  let canvas = limitLongSide(await canvasFromBlob(original), PROCESS_LONG_SIDE);
  // Improve before detection so the blur is not sharpened away afterwards.
  canvas = autoImproveCanvas(canvas);
  for (const region of await findIdentifierRegions(canvas)) redactRect(canvas, region);
  const improved = canvas;
  let output = improved;
  const removed = cleanRemovedAlpha(await removeBackgroundCanvas(improved));
  const context = removed.getContext("2d", { willReadFrequently: true });
  const pixels = context?.getImageData(0, 0, removed.width, removed.height);
  if (pixels && opaqueFraction(pixels.data, SUBJECT_ALPHA_MIN) >= MIN_SUBJECT_FRACTION) {
    const crop = subjectBounds(pixels.data, removed.width, removed.height, SUBJECT_ALPHA_MIN);
    output = flattenOnWhite(crop ? cropCanvas(removed, crop) : removed);
  }
  await uploadProcessedItemImage({
    itemId: claim.itemId,
    imageId: claim.imageId,
    startedAt: claim.startedAt,
    blob: await exportForListing(output, false),
  });
}

async function processItemImage(image: ItemImage): Promise<void> {
  if (image.processingStatus === "ready") return;
  const claim = await claimItemImageProcessing(image.id);
  if (!claim) return;
  try {
    await runPipeline(claim);
  } catch (error) {
    const message = shortError(error);
    const recorded = await failItemImageProcessing({ imageId: image.id, startedAt: claim.startedAt, message }).catch(
      () => false,
    );
    if (recorded) throw new Error(message);
  }
}

/** One photo at a time so a phone is not running two background-removal models. */
export function enqueueItemImageProcessing(image: ItemImage): Promise<void> {
  const run = tail.then(() => processItemImage(image));
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
