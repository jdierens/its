export type ImageMeta = {
  width: number;
  height: number;
  orientation: number;
};

export type ImageFit = {
  width: number;
  height: number;
  orientation: number;
};

/** Pixel size and EXIF orientation (1–8). JPEG, PNG, and WebP only. */
export function readImageMeta(bytes: Uint8Array): ImageMeta | null {
  if (isPng(bytes)) return readPng(bytes);
  if (isWebp(bytes)) return readWebp(bytes);
  if (isJpeg(bytes)) return readJpeg(bytes);
  return null;
}

/**
 * Long edge capped at maxEdge, after EXIF orientation.
 * Orientation 5–8 swaps the stored width and height (camera photos on Android and iOS).
 * Smaller photos are not enlarged.
 */
export function fitImage(width: number, height: number, orientation: number, maxEdge: number): ImageFit {
  const orient = orientation >= 1 && orientation <= 8 ? orientation : 1;
  const swapped = orient >= 5;
  const orientedWidth = Math.max(1, swapped ? height : width);
  const orientedHeight = Math.max(1, swapped ? width : height);
  const edge = Math.max(orientedWidth, orientedHeight);
  const scale = maxEdge > 0 && edge > maxEdge ? maxEdge / edge : 1;
  return {
    width: Math.max(1, Math.round(orientedWidth * scale)),
    height: Math.max(1, Math.round(orientedHeight * scale)),
    orientation: orient,
  };
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length > 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

function readPng(bytes: Uint8Array): ImageMeta | null {
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  if (!width || !height) return null;
  return { width, height, orientation: 1 };
}

function readWebp(bytes: Uint8Array): ImageMeta | null {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X" && bytes.length >= 30) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    if (width > 1 && height > 1) return { width, height, orientation: 1 };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    const width = bytes[26] | (bytes[27] << 8);
    const height = bytes[28] | (bytes[29] << 8);
    if (width && height) return { width, height, orientation: 1 };
  }
  return null;
}

function readJpeg(bytes: Uint8Array): ImageMeta | null {
  let orientation = 1;
  let width = 0;
  let height = 0;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) break;
    const start = i + 4;
    if (marker === 0xe1) {
      const found = exifOrientation(bytes, start, length - 2);
      if (found) orientation = found;
    }
    const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (sof && length >= 7) {
      height = (bytes[start + 1] << 8) | bytes[start + 2];
      width = (bytes[start + 3] << 8) | bytes[start + 4];
    }
    i += 2 + length;
  }
  if (!width || !height) return null;
  return { width, height, orientation };
}

function exifOrientation(bytes: Uint8Array, start: number, length: number): number | null {
  if (length < 16 || ascii(bytes, start, 4) !== "Exif" || bytes[start + 4] !== 0 || bytes[start + 5] !== 0) return null;
  const tiff = start + 6;
  const end = start + length;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (offset: number) => (little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1]);
  const u32 = (offset: number) =>
    little
      ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
      : ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  if (tiff + 8 > end || u16(tiff + 2) !== 0x2a) return null;
  let ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end || ifd < tiff) return null;
  const count = u16(ifd);
  ifd += 2;
  for (let entry = 0; entry < count; entry += 1) {
    const at = ifd + entry * 12;
    if (at + 12 > bytes.length) break;
    if (u16(at) !== 0x0112) continue;
    const value = u16(at + 8);
    if (value >= 1 && value <= 8) return value;
  }
  return null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(bytes[offset + i] ?? 0);
  return text;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}
