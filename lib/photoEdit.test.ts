import assert from "node:assert/strict";
import test from "node:test";
import { REMOVED_ALPHA_THRESHOLD, cleanRemovedAlphaPixels } from "./photoEdit.ts";

function pixel(data: Uint8ClampedArray, index: number): number[] {
  const offset = index * 4;
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
}

function onWhite(red: number, green: number, blue: number, alpha: number): number[] {
  const cover = alpha / 255;
  return [red, green, blue].map((channel) => Math.round(channel * cover + 255 * (1 - cover)));
}

test("near-transparent crumbs are cleared and a soft edge is kept", () => {
  assert.equal(REMOVED_ALPHA_THRESHOLD, 24);
  const data = new Uint8ClampedArray([
    180, 180, 180, 12,
    160, 160, 160, 23,
    40, 50, 60, 24,
    20, 30, 40, 80,
    8, 9, 10, 255,
  ]);
  const dirty = onWhite(180, 180, 180, 12);
  assert.ok(dirty.every((channel) => channel < 252));

  cleanRemovedAlphaPixels(data);

  assert.deepEqual(pixel(data, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(data, 1), [0, 0, 0, 0]);
  assert.deepEqual(onWhite(0, 0, 0, 0), [255, 255, 255]);
  assert.deepEqual(pixel(data, 2), [40, 50, 60, 24]);
  assert.deepEqual(pixel(data, 3), [20, 30, 40, 80]);
  assert.deepEqual(pixel(data, 4), [8, 9, 10, 255]);
});
