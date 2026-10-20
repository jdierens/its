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

/** Shrink a large photo to a JPEG before upload. GIFs stay as they are. */
export async function compressImage(
  file: File,
  force = false,
  maxEdge = COMPRESS_MAX_EDGE,
  quality = JPEG_QUALITY,
): Promise<File> {
  if (!shouldCompress(file, force)) return file;
  if (typeof document === "undefined") return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    throw new Error(`${file.name} could not be read. Use a JPEG or PNG.`);
  }

  const edge = maxEdge > 0 ? maxEdge : COMPRESS_MAX_EDGE;
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) return file;
  return new File([blob], jpegName(file.name || "photo.jpg"), { type: "image/jpeg", lastModified: Date.now() });
}
