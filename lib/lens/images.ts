export const MAX_LENS_IMAGES = 4;
export const MAX_LENS_IMAGE_BYTES = 700_000;
export const MAX_LENS_TOTAL_BYTES = 2_000_000;

const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type LensImage = {
  mimeType: string;
  data: string;
};

export function decodedBase64Bytes(data: string): number {
  const clean = data.replace(/\s/g, "");
  if (!clean) return 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - (clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0));
}

export function readLensImages(value: unknown): { ok: true; images: LensImage[] } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Send 1 to 4 photos." };
  }
  const images = (value as { images?: unknown }).images;
  if (!Array.isArray(images) || images.length === 0) return { ok: false, message: "Add at least one photo." };
  if (images.length > MAX_LENS_IMAGES) return { ok: false, message: "Lens accepts at most 4 photos." };
  const accepted: LensImage[] = [];
  let total = 0;
  for (const image of images) {
    if (!image || typeof image !== "object") return { ok: false, message: "A photo could not be read." };
    const record = image as { mimeType?: unknown; data?: unknown };
    const mimeType = typeof record.mimeType === "string" ? record.mimeType.toLowerCase() : "";
    if (!MIME_TYPES.has(mimeType)) return { ok: false, message: "Use JPEG, PNG, or WebP photos." };
    const data = typeof record.data === "string" ? record.data.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s/g, "") : "";
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { ok: false, message: "A photo could not be read." };
    const bytes = decodedBase64Bytes(data);
    if (bytes > MAX_LENS_IMAGE_BYTES) return { ok: false, message: "A photo is too large. Take it again closer to the label." };
    total += bytes;
    if (total > MAX_LENS_TOTAL_BYTES) return { ok: false, message: "Those photos are too large together." };
    accepted.push({ mimeType, data });
  }
  return { ok: true, images: accepted };
}
