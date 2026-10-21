import assert from "node:assert/strict";
import test from "node:test";
import { prefersFileShare } from "./download.ts";

test("iPhone, iPad, and iPod use a navigation download", () => {
  assert.equal(prefersFileShare("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)"), true);
  assert.equal(prefersFileShare("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)"), true);
  assert.equal(prefersFileShare("Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)"), true);
});

test("iPadOS desktop mode is detected from the Mac platform plus touch", () => {
  assert.equal(prefersFileShare("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", {
    platform: "MacIntel",
    maxTouchPoints: 5,
  }), true);
  assert.equal(prefersFileShare("Mozilla/5.0 (Macintosh) Chrome/120", { platform: "MacIntel", maxTouchPoints: 0 }), false);
});

test("Android Chrome and desktop browsers keep the scripted download", () => {
  assert.equal(prefersFileShare("Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120.0.0.0 Mobile"), false);
  assert.equal(prefersFileShare("Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120.0.0.0"), false);
});
