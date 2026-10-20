import { NextResponse } from "next/server";
import { geminiApiKey, geminiConfigured, geminiModel } from "@/lib/lens/config";
import { identifyWithGemini } from "@/lib/lens/gemini";
import { readLensImages } from "@/lib/lens/images";
import { allowLensCaller } from "@/lib/lens/limit";
import { lensPrompt, parseLensReading } from "@/lib/lens/parse";
import { lensNeedles, rankLensMatches } from "@/lib/lens/rank";
import { findLensCandidates, loadTaxonomyNames } from "@/lib/lens/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json(
    { configured: geminiConfigured(), model: geminiModel() },
    { headers: { "Cache-Control": "no-store" } },
  );
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
  try {
    const taxonomies = await loadTaxonomyNames();
    const raw = await identifyWithGemini({
      apiKey: key,
      model: geminiModel(),
      prompt: lensPrompt(taxonomies),
      images: images.images,
    });
    const reading = parseLensReading(raw);
    if (!reading) return NextResponse.json({ configured: true, message: "Lens could not read those photos." }, { status: 502 });
    const matches = rankLensMatches(reading, await findLensCandidates(lensNeedles(reading)));
    return NextResponse.json({ configured: true, model: geminiModel(), reading, matches });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lens could not read those photos.";
    return NextResponse.json({ configured: true, message }, { status: 502 });
  }
}
