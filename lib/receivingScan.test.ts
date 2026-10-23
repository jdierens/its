import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { receiptChangeSummary, scanSearchNote, scanTokensInSearchOrder } from "@/lib/receivingScan";

describe("receiving scan tokens", () => {
  it("searches the part number before the date code and the country", () => {
    assert.deepEqual(scanTokensInSearchOrder("KR M393A8G40BB4-CWE 2349"), [
      "M393A8G40BB4-CWE",
      "2349",
      "KR",
    ]);
    assert.deepEqual(scanTokensInSearchOrder("  AB12   WXYZ  99 "), ["AB12", "WXYZ", "99"]);
    assert.deepEqual(scanTokensInSearchOrder("1001"), ["1001"]);
    assert.equal(
      scanSearchNote({ token: "M393A8G40BB4-CWE", tried: ["M393A8G40BB4-CWE", "2349", "KR"], found: true }),
      "Searched M393A8G40BB4-CWE.",
    );
    assert.equal(scanSearchNote({ token: "1001", tried: ["1001"], found: true }), null);
  });

  it("asks before a qty or SKU change", () => {
    assert.equal(receiptChangeSummary({ sku: "1001", nextSku: "1001", qty: 2, nextQty: 2 }), null);
    assert.match(receiptChangeSummary({ sku: "1001", nextSku: "1001", qty: 2, nextQty: 4 }) ?? "", /qty from 2 to 4/);
    assert.match(
      receiptChangeSummary({ sku: "1001", nextSku: "103987", qty: 2, nextQty: 2 }) ?? "",
      /SKU from 1001 to 103987/,
    );
  });
});
