import assert from "node:assert/strict";
import test from "node:test";
import { productUrlError, productUrlHref } from "./productUrl.ts";

test("a product page accepts an empty value and an http or https URL", () => {
  assert.equal(productUrlError(""), null);
  assert.equal(productUrlError("  "), null);
  assert.equal(productUrlError(" https://example.com/item?id=1 "), null);
  assert.equal(productUrlHref(" https://example.com/item?id=1 "), "https://example.com/item?id=1");
  assert.equal(productUrlHref("http://localhost:3000/items"), "http://localhost:3000/items");
});

test("a product page rejects anything that is not an http or https URL", () => {
  assert.equal(productUrlError("example.com"), "Product page must be an http or https URL.");
  assert.equal(productUrlError("javascript:alert(1)"), "Product page must be an http or https URL.");
  assert.equal(productUrlError("https://example.com/a b"), "Product page must be an http or https URL.");
  assert.equal(productUrlHref("javascript:alert(1)"), null);
  assert.equal(productUrlHref(""), null);
});
