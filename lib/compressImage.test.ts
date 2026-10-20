import assert from "node:assert/strict";
import test from "node:test";
import { COMPRESS_OVER_BYTES, shouldCompress } from "./compressImage.ts";

test("large photos and phone HEIC files are compressed, and GIFs are not", () => {
  assert.equal(shouldCompress({ size: COMPRESS_OVER_BYTES + 1, type: "image/jpeg" }), true);
  assert.equal(shouldCompress({ size: 20_000, type: "image/jpeg" }), false);
  assert.equal(shouldCompress({ size: 20_000, type: "image/heic" }), true);
  assert.equal(shouldCompress({ size: 9_000_000, type: "image/gif" }), false);
  assert.equal(shouldCompress({ size: 20_000, type: "image/jpeg" }, true), true);
});
