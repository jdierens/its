import type { BinType } from "@/lib/bins";

/** Printed on a bin label. The type word (BOX, CRATE, PALLET) is not printed. */
export const BIN_LABEL_BRAND = "DDS";

/** Code 128 of the bin reference, such as 10041-C. The human-readable line is separate. */
export const BIN_BARCODE_FORMAT = "CODE128";

/**
 * Crate and box (DK-1201). Named like the Brother dialog: tape width, then feed.
 * The page is landscape, so 90 mm is the width and 29 mm is the height.
 */
export const BIN_LABEL_SIZE = "29 × 90 mm";
export const BIN_LABEL_WIDTH_MM = 90;
export const BIN_LABEL_HEIGHT_MM = 29;

/** Bars plus quiet zone, kept inside the 90 mm label. */
export const BIN_BARCODE_MAX_MM = 84;

/**
 * Crate and box bar height, in CSS pixels. The 29 × 90 mm label still uses this.
 * At 96 CSS px per inch it is about 13.2 mm.
 */
export const BIN_BARCODE_HEIGHT_PX = 50;

/** Quiet zone on each side, in modules. Code 128 wants about ten. */
export const BIN_BARCODE_QUIET_MODULES = 10;

/**
 * Pallet (DK-1202). Same page as the serial label: tape width, then feed.
 * The page is landscape, so the 100 mm feed is the width and the 62 mm tape is the height.
 */
export const PALLET_LABEL_SIZE = "62 × 100 mm";
export const PALLET_LABEL_WIDTH_MM = 100;
export const PALLET_LABEL_HEIGHT_MM = 62;

/** Side padding. The reference uses the width that remains. The barcode max sits inside it. */
export const PALLET_LABEL_PAD_X_MM = 3;

/**
 * Top and bottom padding. DK-1202 does not print the last ~1.5 mm of the 62 mm tape.
 * Those edges are the top and bottom of this landscape page, same as the serial label.
 */
export const PALLET_LABEL_PAD_TOP_MM = 2.2;
export const PALLET_LABEL_PAD_BOTTOM_MM = 2.6;

/** Small DDS centered above the bars. */
export const PALLET_BRAND_FONT_MM = 5;
export const PALLET_BRAND_LETTER_SPACING_EM = 0.42;

/** Gap between DDS, the bars, and the reference. */
export const PALLET_STACK_GAP_MM = 2;

/**
 * Code 128 bar height. About 50% taller than option A of the pallet mocks.
 * 16 mm is the approved height. The ten-module quiet zone stays on each side.
 */
export const PALLET_BARCODE_HEIGHT_MM = 16;

/** Bars plus quiet zone. Same cap as the serial label, inside the side padding. */
export const PALLET_BARCODE_MAX_MM = 90;

/** Preferred QR side on a pallet label. A larger symbol grows up to the room that is left. */
export const PALLET_QR_MAX_MM = 28;

/** The reference under a pallet QR stays at least this tall. */
export const PALLET_REF_MIN_MM = 10;

export type BinLabelStock = "DK-1201" | "DK-1202";

export type BinLabelPage = {
  widthMm: number;
  heightMm: number;
  /** Tape width × feed, as the Brother dialog names the paper. */
  paper: string;
  stock: BinLabelStock;
};

/** Crate and box keep DDS beside the reference. Pallet stacks DDS, bars, then the reference. */
export function binBarcodeLayout(type: BinType): "mixed" | "beside" {
  return type === "P" ? "mixed" : "beside";
}

export function binLabelPage(type: BinType): BinLabelPage {
  if (type === "P") {
    return {
      widthMm: PALLET_LABEL_WIDTH_MM,
      heightMm: PALLET_LABEL_HEIGHT_MM,
      paper: PALLET_LABEL_SIZE,
      stock: "DK-1202",
    };
  }
  return {
    widthMm: BIN_LABEL_WIDTH_MM,
    heightMm: BIN_LABEL_HEIGHT_MM,
    paper: BIN_LABEL_SIZE,
    stock: "DK-1201",
  };
}

/** Width the pallet reference can use, inside the side padding. */
export function palletReferenceWidthMm(): number {
  return PALLET_LABEL_WIDTH_MM - PALLET_LABEL_PAD_X_MM * 2;
}

/**
 * Largest reference font before it has to shrink to the label width.
 * `middleMm` is the barcode or QR between DDS and the reference.
 */
export function palletReferenceMaxFontMm(middleMm: number): number {
  const inner = PALLET_LABEL_HEIGHT_MM - PALLET_LABEL_PAD_TOP_MM - PALLET_LABEL_PAD_BOTTOM_MM;
  const used = PALLET_BRAND_FONT_MM + middleMm + PALLET_STACK_GAP_MM * 2;
  return Math.max(0, inner - used);
}

/**
 * QR side for a pallet label. A short reference grows to PALLET_QR_MAX_MM.
 * A dense symbol stays at its natural size until the reference would have
 * less than PALLET_REF_MIN_MM left, then the symbol stops growing.
 */
export function palletQrSideMm(naturalMm: number): number {
  if (!(naturalMm > 0)) return 0;
  const innerH = PALLET_LABEL_HEIGHT_MM - PALLET_LABEL_PAD_TOP_MM - PALLET_LABEL_PAD_BOTTOM_MM;
  const maxSide = Math.max(
    0,
    Math.min(
      palletReferenceWidthMm(),
      innerH - PALLET_BRAND_FONT_MM - PALLET_STACK_GAP_MM * 2 - PALLET_REF_MIN_MM,
    ),
  );
  const preferred = Math.min(PALLET_QR_MAX_MM, maxSide);
  return Math.min(Math.max(naturalMm, preferred), maxSide);
}

/**
 * Font size for the pallet reference. It stays at `basePx` (the remaining height)
 * until that width would pass `maxWidthPx`, then it scales down so the line fits.
 */
export function fittedFontSize(input: { textWidthPx: number; maxWidthPx: number; basePx: number }): number {
  if (!(input.basePx > 0)) return 0;
  if (!(input.maxWidthPx > 0) || !(input.textWidthPx > 0)) return input.basePx;
  if (input.textWidthPx <= input.maxWidthPx) return input.basePx;
  return (input.basePx * input.maxWidthPx) / input.textWidthPx;
}

/** Bold Helvetica/Arial advance, in em. Digits match Arial's tabular width. */
export function approxBoldEm(text: string): number {
  let em = 0;
  for (const char of text) {
    if (char >= "0" && char <= "9") em += 0.556;
    else if (char === "-") em += 0.333;
    else if (char === " ") em += 0.278;
    else em += 0.66;
  }
  return em;
}

export function approxBoldWidthPx(text: string, fontPx: number): number {
  if (!(fontPx > 0)) return 0;
  return approxBoldEm(text) * fontPx;
}

export type BinLabelPrintMode = "standard" | "pallet" | "mixed";

export type BinLabelSheet = {
  mode: BinLabelPrintMode;
  /** Unnamed @page follows the pallet size when this is true. */
  defaultPallet: boolean;
};

export function binLabelPrintMode(types: readonly string[]): BinLabelPrintMode {
  let pallet = false;
  let other = false;
  for (const type of types) {
    if (type === "P") pallet = true;
    else other = true;
  }
  if (pallet && other) return "mixed";
  if (pallet) return "pallet";
  return "standard";
}

/** Page size for one print job. A mixed job's unnamed page follows the first label. */
export function binLabelSheet(types: readonly string[]): BinLabelSheet {
  const mode = binLabelPrintMode(types);
  const first = types.find((type) => type === "P" || type === "C" || type === "B");
  return {
    mode,
    defaultPallet: mode === "pallet" || (mode === "mixed" && first === "P"),
  };
}

/**
 * Page for a screen that shows one bin and can also print an item label.
 * The bin on screen decides the page, including while nobody is printing.
 * An item print uses the crate/box page so the item label stays 29 × 90 mm.
 */
export function previewBinLabelSheet(binType: string | null | undefined, printingItem: boolean): BinLabelSheet {
  if (printingItem) return binLabelSheet(["B"]);
  if (binType === "P" || binType === "C" || binType === "B") return binLabelSheet([binType]);
  return binLabelSheet(["B"]);
}

/** Dashed preview frame. A pallet frame is 100 mm wide; crate and box stay 90 mm. */
export function binLabelFrameClass(type: string | null | undefined): string {
  return type === "P" ? "label-frame label-frame-pallet" : "label-frame";
}

/** Click target around a bin label. A pallet target reserves the 62 mm tape height. */
export function binLabelHitClass(type: string | null | undefined): string {
  return type === "P" ? "bin-label-hit bin-label-hit-pallet" : "bin-label-hit";
}

export function binLabelAtPageMm(sheet: BinLabelSheet): { widthMm: number; heightMm: number } {
  const pallet = sheet.mode === "pallet" || (sheet.mode === "mixed" && sheet.defaultPallet);
  return pallet
    ? { widthMm: PALLET_LABEL_WIDTH_MM, heightMm: PALLET_LABEL_HEIGHT_MM }
    : { widthMm: BIN_LABEL_WIDTH_MM, heightMm: BIN_LABEL_HEIGHT_MM };
}

/**
 * Named page for a label whose stock differs from the job's unnamed page.
 * A one-type job leaves this empty so the browser does not insert a blank page.
 */
export function binLabelNamedPage(
  type: BinType,
  sheet: BinLabelSheet,
): "bin-pallet" | "bin-standard" | null {
  if (sheet.mode !== "mixed") return null;
  const pallet = type === "P";
  if (pallet === sheet.defaultPallet) return null;
  return pallet ? "bin-pallet" : "bin-standard";
}

export function mmToCssPx(mm: number): number {
  return (mm * 96) / 25.4;
}

/**
 * Module width that makes a barcode drawn at width 1 grow to `targetPx`.
 * Quiet zone is included in `widthAtUnit`, so it scales with the bars.
 */
export function scaledModuleWidth(widthAtUnit: number, targetPx: number): number {
  if (!(widthAtUnit > 0) || !(targetPx > 0)) return 1;
  return targetPx / widthAtUnit;
}

/** Share of the barcode width that is quiet zone on one side. The text sits inside it. */
export function quietInsetRatio(totalPx: number, quietPx: number): number {
  if (!(totalPx > 0) || !(quietPx > 0)) return 0;
  return Math.min(0.45, quietPx / totalPx);
}
