import { NextResponse } from "next/server";
import { geminiApiKey, geminiConfigured, geminiModel } from "@/lib/lens/config";
import { GeminiRequestError, geminiThinkingLevel, identifyWithGemini, keyLast4, lensLog, probeGemini } from "@/lib/lens/gemini";
import { decodedBase64Bytes, readLensImages } from "@/lib/lens/images";
import { allowLensCaller } from "@/lib/lens/limit";
import { lensPrompt, parseLensReading } from "@/lib/lens/parse";
import { lensNeedles, rankLensMatches } from "@/lib/lens/rank";
import { findLensCandidates, loadTaxonomyNames } from "@/lib/lens/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (new URL(request.url).searchParams.get("probe") === "1") {
    if (process.env.VERCEL_ENV === "production") {
      return NextResponse.json({ probe: false }, { status: 404, headers });
    }
    const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!allowLensCaller(`probe:${caller}`)) {
      return NextResponse.json({ probe: true, message: "Probe is busy. Wait a few minutes and try again." }, { status: 429, headers });
    }
    const key = geminiApiKey();
    const model = geminiModel();
    if (!key) return NextResponse.json({ probe: true, configured: false, model, keyLast4: null }, { headers });
    const result = await probeGemini({ apiKey: key, model });
    return NextResponse.json({ probe: true, configured: true, model, keyLast4: keyLast4(key), ...result }, { headers });
  }
  return NextResponse.json({ configured: geminiConfigured(), model: geminiModel() }, { headers });
}

export async function POST(request: Request) {
  if (!geminiConfigured()) {
    return NextResponse.json({ configured: false, model: geminiModel(), reading: null, matches: [] });
  }
  const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowLensCaller(caller)) {
    return NextResponse.json({ configured: true, message: "Lens is busy. Wait a few minutes and try again." }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ configured: true, message: "Send 1 to 4 photos." }, { status: 400 });
  }
  const images = readLensImages(body);
  if (!images.ok) return NextResponse.json({ configured: true, message: images.message }, { status: 400 });
  const key = geminiApiKey();
  if (!key) return NextResponse.json({ configured: false, model: geminiModel(), reading: null, matches: [] });
  const started = Date.now();
  const imageBytes = images.images.reduce((sum, image) => sum + decodedBase64Bytes(image.data), 0);
  lensLog({
    event: "post",
    region: process.env.VERCEL_REGION || "",
    model: geminiModel(),
    imageCount: images.images.length,
    imageBytes,
    contentLength: request.headers.get("content-length") || "",
  });
  try {
    const taxonomies = await loadTaxonomyNames();
    const names = taxonomies.map((name) => name.trim()).filter(Boolean);
    const prompt = lensPrompt(names);
    const model = geminiModel();
    const result = await identifyWithGemini({
      apiKey: key,
      model,
      prompt,
      images: images.images,
    });
    const reading = parseLensReading(result.raw);
    const gemini = geminiFacts({
      imageBytes,
      taxonomyCount: names.length,
      result,
    });
    if (!reading) return NextResponse.json({ configured: true, message: "Lens could not read those photos.", gemini }, { status: 502 });
    const matches = rankLensMatches(reading, await findLensCandidates(lensNeedles(reading)));
    return NextResponse.json({ configured: true, model, reading, matches, gemini });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lens could not read those photos.";
    const gemini = error instanceof GeminiRequestError
      ? geminiFacts({
          imageBytes,
          taxonomyCount: null,
          result: error,
        })
      : null;
    lensLog({
      event: "post-error",
      region: process.env.VERCEL_REGION || "",
      model: geminiModel(),
      imageCount: images.images.length,
      imageBytes,
      elapsedMs: gemini?.elapsedMs ?? Date.now() - started,
      promptChars: gemini?.promptChars ?? "",
      thinkingLevel: gemini?.thinkingLevel ?? geminiThinkingLevel(geminiModel()),
      thoughtTokens: gemini?.thoughtTokens ?? "",
      promptTokens: gemini?.promptTokens ?? "",
      outputTokens: gemini?.outputTokens ?? "",
      message,
    });
    return NextResponse.json({ configured: true, message, gemini }, { status: 502 });
  }
}

function geminiFacts(input: {
  imageBytes: number;
  taxonomyCount: number | null;
  result: { elapsedMs: number; promptChars: number; thinkingLevel: string; usage: { promptTokens: number | null; outputTokens: number | null; thoughtTokens: number | null } };
}) {
  return {
    elapsedMs: input.result.elapsedMs,
    imageBytes: input.imageBytes,
    promptChars: input.result.promptChars,
    taxonomyCount: input.taxonomyCount,
    thinkingLevel: input.result.thinkingLevel,
    promptTokens: input.result.usage.promptTokens,
    outputTokens: input.result.usage.outputTokens,
    thoughtTokens: input.result.usage.thoughtTokens,
  };
}
