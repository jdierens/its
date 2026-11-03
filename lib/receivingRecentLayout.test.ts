import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("recent entries DMG and comment", () => {
  const page = readFileSync(new URL("../components/ReceivingPage.tsx", import.meta.url), "utf8");
  const row = readFileSync(new URL("../components/ReceiptInline.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  it("puts DMG in the column header and keeps the per-row box unlabeled", () => {
    assert.match(page, /<th className="fit dmg">DMG<\/th>\s*<th className="note">Comment<\/th>/);
    assert.match(row, /<td className="fit dmg">/);
    assert.match(row, /className="receive-c"/);
    assert.doesNotMatch(row, /className="receipt-dmg"/);
    assert.doesNotMatch(row, /receipt-note/);
    const damaged = row.slice(row.indexOf("function DamagedBox"), row.indexOf("function ConfirmBar"));
    assert.doesNotMatch(damaged, />\s*DMG\s*</);
  });

  it("top-aligns the comment with the other cells", () => {
    assert.match(css, /\.receive-table td\.note\s*\{[^}]*vertical-align:\s*top/);
    assert.match(css, /\.receive-card-row dt\.note,\s*\.receive-card-row dd\.note\s*\{[^}]*align-self:\s*start/);
    assert.match(css, /\.receive-c,\s*\.ds \.receive-c\s*\{[^}]*width:\s*22px;\s*height:\s*22px/);
  });
});
