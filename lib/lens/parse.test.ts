import assert from "node:assert/strict";
import test from "node:test";
import { parseLensReading } from "./parse.ts";
import { readLensImages } from "./images.ts";
import { takeLensSlot } from "./limit.ts";

test("a Gemini reading keeps part numbers and a spec code", () => {
  const reading = parseLensReading({
    manufacturer: " Intel ",
    partNumbers: ["CM8068403654210", "S RF8W", "CM8068403654210"],
    model: "Xeon Gold 6248",
    itemType: "Bundle",
    taxonomy: "Processor",
    specs: [{ name: "S-Spec", value: "SRF8W" }, { name: "Cores", value: "20" }],
    conditionHints: "used",
    rawText: "INTEL XEON",
    confidence: "1.4",
  });
  assert.equal(reading?.manufacturer, "Intel");
  assert.deepEqual(reading?.partNumbers, ["CM8068403654210", "S RF8W"]);
  assert.equal(reading?.itemType, "");
  assert.deepEqual(reading?.specCodes, ["SRF8W"]);
  assert.equal(reading?.confidence, 1);
});

test("photos are limited to four jpeg, png, or webp images", () => {
  const tiny = Buffer.from("hello").toString("base64");
  assert.equal(readLensImages({ images: [] }).ok, false);
  assert.equal(readLensImages({ images: [{ mimeType: "image/gif", data: tiny }] }).ok, false);
  const images = Array.from({ length: 5 }, () => ({ mimeType: "image/jpeg", data: tiny }));
  assert.match(readLensImages({ images }).ok ? "" : (readLensImages({ images }) as { message: string }).message, /4 photos/);
  const accepted = readLensImages({ images: [{ mimeType: "image/jpeg", data: `data:image/jpeg;base64,${tiny}` }] });
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.images[0]?.data, tiny);
});

test("lens allows eight calls in ten minutes", () => {
  const history: number[] = [];
  let current = history;
  for (let i = 0; i < 8; i += 1) {
    const slot = takeLensSlot({ now: 1_000 + i, history: current, windowMs: 1000, limit: 8 });
    assert.equal(slot.ok, true);
    current = slot.history;
  }
  assert.equal(takeLensSlot({ now: 1_008, history: current, windowMs: 1000, limit: 8 }).ok, false);
  assert.equal(takeLensSlot({ now: 3_000, history: current, windowMs: 1000, limit: 8 }).ok, true);
});
