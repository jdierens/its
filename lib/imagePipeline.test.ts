import assert from "node:assert/strict";
import test from "node:test";
import { REMOVED_ALPHA_THRESHOLD } from "./photoEdit.ts";
import {
  SUBJECT_ALPHA_MIN,
  PROCESSING_STALE_MS,
  boxFromPoints,
  identifierBoxes,
  imageProcessingColumnMissing,
  imageProcessingStatus,
  isProcessedImagePath,
  isUniqueIdentifierToken,
  lineHasSerialLabel,
  looksLikeCodeValue,
  opaqueFraction,
  processedImagePath,
  processingClaimIsStale,
  storagePathsForImage,
  subjectBounds,
  type OcrLine,
} from "./imagePipeline.ts";

const ITEM = "11111111-1111-4111-8111-111111111111";
const IMAGE = "22222222-2222-4222-8222-222222222222";

function word(text: string, x: number, y: number, w = 40, h = 16) {
  return { text, x, y, w, h };
}

function line(text: string, words: ReturnType<typeof word>[], y = 10): OcrLine {
  return { text, x: 8, y, w: 180, h: 18, words };
}

test("subject alpha matches the editor cleanup cutoff", () => {
  assert.equal(SUBJECT_ALPHA_MIN, REMOVED_ALPHA_THRESHOLD);
});

test("a missing processing column is recognized without hiding other errors", () => {
  assert.equal(
    imageProcessingColumnMissing({
      code: "PGRST204",
      message: "Could not find the 'processing_status' column of 'item_images' in the schema cache",
    }),
    true,
  );
  assert.equal(imageProcessingColumnMissing({ code: "42703", message: "column original_storage_path does not exist" }), true);
  assert.equal(imageProcessingColumnMissing({ code: "PGRST204", message: "Could not find the 'sku' column" }), false);
  assert.equal(imageProcessingColumnMissing(null), false);
});

test("processing status and stale claims", () => {
  assert.equal(imageProcessingStatus("pending"), "pending");
  assert.equal(imageProcessingStatus("nope"), "ready");
  const now = Date.parse("2026-11-02T12:00:00.000Z");
  assert.equal(processingClaimIsStale("pending", null, now), true);
  assert.equal(processingClaimIsStale("failed", null, now), true);
  assert.equal(processingClaimIsStale("ready", null, now), false);
  assert.equal(processingClaimIsStale("processing", null, now), true);
  assert.equal(processingClaimIsStale("processing", "not-a-date", now), true);
  assert.equal(processingClaimIsStale("processing", new Date(now - 60_000).toISOString(), now), false);
  assert.equal(
    processingClaimIsStale("processing", new Date(now - PROCESSING_STALE_MS).toISOString(), now),
    true,
  );
});

test("storage paths keep the original and the processed file once", () => {
  assert.deepEqual(
    storagePathsForImage({ storagePath: "a/b.jpg", originalStoragePath: "a/b.jpg" }),
    ["a/b.jpg"],
  );
  assert.deepEqual(
    storagePathsForImage({ storagePath: "a/b.processed-abcd1234.jpg", originalStoragePath: "a/b.jpg" }),
    ["a/b.processed-abcd1234.jpg", "a/b.jpg"],
  );
  assert.deepEqual(storagePathsForImage({ storagePath: "  ", originalStoragePath: null }), []);
});

test("processed paths stay under the image id", () => {
  const path = processedImagePath(ITEM, IMAGE, "AB-cd_12zzEXTRA");
  assert.equal(path, `${ITEM}/${IMAGE}.processed-abcd12zzextr.jpg`);
  assert.equal(isProcessedImagePath(ITEM, IMAGE, path), true);
  assert.equal(isProcessedImagePath(ITEM, IMAGE, `${ITEM}/${IMAGE}.jpg`), false);
  assert.equal(isProcessedImagePath(ITEM, IMAGE, `${ITEM}/${IMAGE}.processed-abc/../../x.jpg`), false);
  assert.throws(() => processedImagePath(ITEM, IMAGE, "---"), /processed photo/);
});

test("serial labels and unique tokens", () => {
  assert.equal(lineHasSerialLabel("S/N CN7H8X2"), true);
  assert.equal(lineHasSerialLabel("Serial No. 4CE1234567"), true);
  assert.equal(lineHasSerialLabel("Service Tag ABC1234"), true);
  assert.equal(lineHasSerialLabel("IMEI 490154203237518"), true);
  assert.equal(lineHasSerialLabel("serialized firmware"), false);
  assert.equal(lineHasSerialLabel("SNMP community"), false);
  assert.equal(lineHasSerialLabel("P/N M393A8G40BB4-CWE"), false);
  assert.equal(isUniqueIdentifierToken("490154203237518"), true);
  assert.equal(isUniqueIdentifierToken("00:1A:2B:3C:4D:5E"), true);
  assert.equal(isUniqueIdentifierToken("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isUniqueIdentifierToken("1234567890"), true);
  assert.equal(isUniqueIdentifierToken("2024"), false);
  assert.equal(isUniqueIdentifierToken("16GB"), false);
  assert.equal(isUniqueIdentifierToken("M393A8G40BB4-CWE"), false);
  assert.equal(looksLikeCodeValue("CN7H8X2"), true);
  assert.equal(looksLikeCodeValue("HDD"), false);
  assert.equal(looksLikeCodeValue("16GB"), false);
});

test("identifier boxes blur serial lines, payloads, and leave part numbers", () => {
  const lines = [
    line("S/N CN7H8X2", [word("S/N", 8, 10, 24), word("CN7H8X2", 40, 10, 70)]),
    line("Model DCS-7060DX5", [word("Model", 8, 40, 50), word("DCS-7060DX5", 64, 40, 90)], 40),
    line("490154203237518", [word("490154203237518", 8, 70, 120)], 70),
    line("S/N", [word("S/N", 8, 100, 24)], 100),
    line("HX92K1", [word("HX92K1", 8, 120, 60)], 120),
  ];
  const boxes = identifierBoxes(lines, ["CN7H8X2", "SHORT"], 400, 300);
  assert.equal(boxes.length, 3);
  assert.ok(boxes[0].y < 30);
  assert.ok(boxes[1].y >= 60 && boxes[1].y < 100);
  assert.ok(boxes[2].y >= 110);
});

test("a flat barcode scan grows tall enough to cover the digits under it", () => {
  const box = boxFromPoints(
    [
      { x: 20, y: 50 },
      { x: 180, y: 50 },
    ],
    "barcode",
    240,
    160,
  );
  assert.ok(box);
  assert.ok(box.y < 50);
  assert.ok(box.y + box.h > 70);
  assert.ok(box.w > 140);
});

test("a QR box stays near the symbol", () => {
  const box = boxFromPoints(
    [
      { x: 10, y: 10 },
      { x: 70, y: 10 },
      { x: 70, y: 70 },
      { x: 10, y: 70 },
    ],
    "qr",
    200,
    200,
  );
  assert.ok(box);
  assert.ok(box.w < 90);
  assert.ok(box.h < 90);
  assert.ok(box.x < 10);
});

test("subject crop pads the opaque product and skips a full-frame subject", () => {
  const width = 100;
  const height = 80;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 20; y <= 34; y += 1) {
    for (let x = 40; x <= 49; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = 20;
      data[index + 1] = 20;
      data[index + 2] = 20;
      data[index + 3] = 255;
    }
  }
  data[3] = 10;
  assert.deepEqual(subjectBounds(data, width, height), { x: 32, y: 12, w: 26, h: 31 });
  assert.ok(opaqueFraction(data) > 0 && opaqueFraction(data) < 0.05);

  const full = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < full.length; index += 4) full[index] = 255;
  assert.equal(subjectBounds(full, width, height), null);
  assert.equal(subjectBounds(new Uint8ClampedArray(width * height * 4), width, height), null);
});
