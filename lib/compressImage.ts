import { fitImage, readImageMeta } from "@/lib/imageFit";

export const COMPRESS_OVER_BYTES = 1_500_000;
export const COMPRESS_MAX_EDGE = 2000;
const JPEG_QUALITY = 0.82;

export function shouldCompress(file: { size: number; type: string }, force = false): boolean {
  if (file.type === "image/gif") return false;
  if (force) return true;
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  return file.size > COMPRESS_OVER_BYTES;
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return `${base}.jpg`;
}

function photoLabel(file: File): string {
  return file.name || "photo";
}

/**
 * Shrink a photo to a JPEG before upload.
 * Android Chrome camera files are often large JPEGs with EXIF orientation and an empty type.
 * iOS Safari camera and library files are often HEIC, and a full-size canvas can fail there.
 * GIFs stay as they are. A photo that cannot be resized is not returned unchanged.
 */
export async function compressImage(
  file: File,
  force = false,
  maxEdge = COMPRESS_MAX_EDGE,
  quality = JPEG_QUALITY,
): Promise<File> {
  if (!shouldCompress(file, force)) return file;
  if (typeof document === "undefined") return file;

  const edge = maxEdge > 0 ? maxEdge : COMPRESS_MAX_EDGE;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const meta = readImageMeta(bytes);
  const fit = meta ? fitImage(meta.width, meta.height, meta.orientation, edge) : null;
  const bitmap = await decodePhoto(file, fit, edge);
  try {
    const fitted = fitImage(bitmap.width, bitmap.height, 1, edge);
    const canvas = document.createElement("canvas");
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`${photoLabel(file)} could not be resized.`);
    context.drawImage(bitmap, 0, 0, fitted.width, fitted.height);
    const blob = await canvasToJpeg(canvas, quality);
    return new File([blob], jpegName(file.name || "photo.jpg"), { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

async function decodePhoto(file: File, fit: { width: number; height: number } | null, maxEdge: number): Promise<ImageBitmap> {
  const oriented = { imageOrientation: "from-image" as const, resizeQuality: "high" as const };
  if (fit) {
    try {
      return await createImageBitmap(file, { ...oriented, resizeWidth: fit.width, resizeHeight: fit.height });
    } catch {
      // Some browsers reject resize options. The plain decode still applies EXIF.
    }
  } else {
    try {
      // HEIC has no JPEG header. Cap the width while decoding so iOS does not allocate a full camera bitmap.
      return await createImageBitmap(file, { ...oriented, resizeWidth: maxEdge });
    } catch {
      // Fall through to a full decode.
    }
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) throw new Error(`${photoLabel(file)} could not be read. Use a JPEG or PNG.`);
  return bitmap;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (blob: Blob | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      if (blob) resolve(blob);
      else reject(error instanceof Error ? error : new Error("The photo could not be resized."));
    };
    const fromDataUrl = () => {
      try {
        finish(blobFromDataUrl(canvas.toDataURL("image/jpeg", quality)));
      } catch (error) {
        finish(null, error);
      }
    };
    const timer = setTimeout(fromDataUrl, 3000);
    canvas.toBlob((blob) => {
      clearTimeout(timer);
      if (blob) finish(blob);
      else fromDataUrl();
    }, "image/jpeg", quality);
  });
}

function blobFromDataUrl(url: string): Blob {
  const comma = url.indexOf(",");
  const base64 = comma >= 0 ? url.slice(comma + 1) : "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}
