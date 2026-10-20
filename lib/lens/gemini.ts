import { lensResponseSchema } from "@/lib/lens/parse";
import type { LensImage } from "@/lib/lens/images";

export async function identifyWithGemini(input: {
  apiKey: string;
  model: string;
  prompt: string;
  images: LensImage[];
}): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: input.prompt },
              ...input.images.map((image) => ({
                inline_data: { mime_type: image.mimeType, data: image.data },
              })),
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: lensResponseSchema(),
        },
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new Error("Lens could not reach Google.");
  }
  if (response.status === 429) throw new Error("Lens is busy. Wait a moment and try again.");
  if (!response.ok) throw new Error(`Lens could not read those photos (${response.status}).`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Lens could not read those photos.");
  }
  const text = readingText(payload);
  if (!text) throw new Error("Lens could not read those photos.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Lens could not read those photos.");
  }
}

function readingText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return "";
  const first = candidates[0];
  if (!first || typeof first !== "object") return "";
  const parts = (first as { content?: { parts?: unknown } }).content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .join("");
}
