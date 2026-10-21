/** Printed on the left of a bin label. The type word (BOX, CRATE, PALLET) is not printed. */
export const BIN_LABEL_BRAND = "DDS";

/** Code 128 of the bin reference, such as 10041-C. The human-readable line is separate. */
export const BIN_BARCODE_FORMAT = "CODE128";

/** Bars plus quiet zone, kept inside the 90 mm label. */
export const BIN_BARCODE_MAX_MM = 84;

/** Quiet zone on each side, in modules. Code 128 wants about ten. */
export const BIN_BARCODE_QUIET_MODULES = 10;

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
