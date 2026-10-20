import assert from "node:assert/strict";
import test from "node:test";
import { fitImage, readImageMeta } from "./imageFit.ts";

test("phone JPEGs keep EXIF orientation and cap the long edge", () => {
  const landscape = fitImage(4032, 3024, 1, 1280);
  assert.deepEqual(landscape, { width: 1280, height: 960, orientation: 1 });
  const androidPortrait = fitImage(4032, 3024, 6, 1280);
  assert.deepEqual(androidPortrait, { width: 960, height: 1280, orientation: 6 });
  const iosPortrait = fitImage(4032, 3024, 8, 1280);
  assert.deepEqual(iosPortrait, { width: 960, height: 1280, orientation: 8 });
  const small = fitImage(800, 600, 1, 1280);
  assert.deepEqual(small, { width: 800, height: 600, orientation: 1 });
});

test("JPEG and PNG headers report the stored size and EXIF orientation", () => {
  const jpeg = jpegWithOrientation(4032, 3024, 6);
  assert.deepEqual(readImageMeta(jpeg), { width: 4032, height: 3024, orientation: 6 });
  const png = pngHeader(1280, 960);
  assert.deepEqual(readImageMeta(png), { width: 1280, height: 960, orientation: 1 });
  assert.equal(readImageMeta(new Uint8Array([0, 1, 2, 3])), null);
});

function jpegWithOrientation(width: number, height: number, orientation: number): Uint8Array {
  const tiff = bytes([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const exif = concat(bytes([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]), tiff);
  const app1 = concat(bytes([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff]), exif);
  const sof = bytes([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00]);
  return concat(bytes([0xff, 0xd8]), app1, sof, bytes([0xff, 0xd9]));
}

function pngHeader(width: number, height: number): Uint8Array {
  const ihdr = bytes([
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    width >> 24, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    height >> 24, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    0x08, 0x02, 0x00, 0x00, 0x00,
  ]);
  return concat(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr);
}

function bytes(values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
