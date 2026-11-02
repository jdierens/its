import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CUSTOMER_DOCUMENT_PRINT,
  LETTER_MARGIN_IN,
  PICK_TICKET_PRINT,
  letterContentBox,
  letterMarginDeclaration,
  letterPrintClass,
  pageCountFromFragmentHeights,
  pagesForFragment,
  prepareLetterPrint,
  registerLetterPrint,
} from "./letterPrint.ts";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("portrait letter content is the paper inside the customer-document margins", () => {
  assert.deepEqual(LETTER_MARGIN_IN.portrait, { top: 0.28, right: 0.32, bottom: 0.55, left: 0.32 });
  assert.equal(letterMarginDeclaration("portrait"), "0.28in 0.32in 0.55in 0.32in");
  assert.equal(letterContentBox("portrait").widthPx, (8.5 - 0.32 - 0.32) * 96);
  assert.equal(letterContentBox("portrait").heightPx, (11 - 0.28 - 0.55) * 96);
});

test("landscape letter swaps the axes for the pick ticket", () => {
  assert.equal(letterMarginDeclaration("landscape"), "0.4in 0.4in 0.55in 0.4in");
  assert.equal(letterContentBox("landscape").widthPx, (11 - 0.4 - 0.4) * 96);
  assert.equal(letterContentBox("landscape").heightPx, (8.5 - 0.4 - 0.55) * 96);
  assert.ok(letterContentBox("landscape").widthPx > 48 * 16);
});

test("a single page has no numbered class, and two pages do", () => {
  assert.equal(letterPrintClass("portrait", 1), "letter-portrait");
  assert.equal(letterPrintClass("portrait", 2), "letter-portrait-paged");
  assert.equal(letterPrintClass("landscape", 1), "letter-landscape");
  assert.equal(letterPrintClass("landscape", 3), "letter-landscape-paged");
});

test("fragment heights round up on their own, so a terms page adds a page", () => {
  const page = letterContentBox("portrait").heightPx;
  assert.equal(pagesForFragment(page, page), 1);
  assert.equal(pagesForFragment(page + 1, page), 2);
  assert.equal(pagesForFragment(page * 2, page), 2);
  assert.equal(pagesForFragment(Number.NaN, page), 1);
  assert.equal(pageCountFromFragmentHeights([], page), 1);
  assert.equal(pageCountFromFragmentHeights([400], page), 1);
  assert.equal(pageCountFromFragmentHeights([400, 400], page), 2);
  assert.equal(pageCountFromFragmentHeights([page - 20, page * 2 + 5], page), 1 + 3);
});

test("the stylesheet names the same letter pages and only numbers the paged ones", () => {
  for (const orientation of ["portrait", "landscape"] as const) {
    const margin = letterMarginDeclaration(orientation).replaceAll(".", "\\.");
    for (const suffix of ["", "-paged"]) {
      const name = `letter-${orientation}${suffix}`;
      const block = css.match(new RegExp(`@page ${name} \\{[^}]+\\}`));
      assert.ok(block, name);
      assert.match(block[0], new RegExp(`size: letter ${orientation};`));
      assert.match(block[0], new RegExp(`margin: ${margin};`));
    }
    assert.match(css, new RegExp(`@page letter-${orientation}-paged \\{[^}]*content: counter\\(page\\) " of " counter\\(pages\\);`));
    assert.doesNotMatch(css, new RegExp(`@page letter-${orientation} \\{[^}]*counter\\(page\\)`));
    assert.match(css, new RegExp(`html\\.letter-${orientation} body \\{\\s*page: letter-${orientation};`));
    assert.match(css, new RegExp(`html\\.letter-${orientation}-paged body \\{\\s*page: letter-${orientation}-paged;`));
  }
  assert.match(css, /\.letter-measure \.cust-doc \{/);
  assert.match(css, /\.letter-measure \.no-print/);
});

test("customer documents are portrait and the pick ticket is landscape", () => {
  assert.equal(CUSTOMER_DOCUMENT_PRINT.orientation, "portrait");
  assert.equal(CUSTOMER_DOCUMENT_PRINT.fragmentSelector, ".cust-doc");
  assert.equal(PICK_TICKET_PRINT.orientation, "landscape");
  assert.equal("fragmentSelector" in PICK_TICKET_PRINT, false);
});

test("prepareLetterPrint runs only the registered form", () => {
  let calls = 0;
  const stop = registerLetterPrint(() => {
    calls += 1;
  });
  prepareLetterPrint();
  assert.equal(calls, 1);
  stop();
  prepareLetterPrint();
  assert.equal(calls, 1);
});
