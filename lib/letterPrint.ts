/**
 * US Letter print for business forms. The browser paginates; these numbers
 * match the `@page` margins in `app/globals.css`. A one-page form uses the
 * plain named page (no footer). Two or more pages use the `-paged` page,
 * whose margin box prints `1 of 3`.
 */

export const LETTER_CSS_PX_PER_IN = 96;

export const LETTER_PAPER_IN = { width: 8.5, height: 11 } as const;

export type LetterOrientation = "portrait" | "landscape";

/** Portrait matches the customer-document sheet. Landscape gives the pick table its width. */
export const LETTER_MARGIN_IN = {
  portrait: { top: 0.28, right: 0.32, bottom: 0.55, left: 0.32 },
  landscape: { top: 0.4, right: 0.4, bottom: 0.55, left: 0.4 },
} as const;

export const LETTER_PRINT_CLASSES = [
  "letter-portrait",
  "letter-portrait-paged",
  "letter-landscape",
  "letter-landscape-paged",
] as const;

/** Each `.cust-doc` is its own run of pages. The terms article breaks before itself. */
export const CUSTOMER_DOCUMENT_PRINT = {
  orientation: "portrait",
  rootSelector: ".cust-doc-page",
  fragmentSelector: ".cust-doc",
} as const;

export const PICK_TICKET_PRINT = {
  orientation: "landscape",
  rootSelector: "main.pick-page",
} as const;

/** Quote export is the DDS bid and FMP sheet. Six columns fit the portrait letter. */
export const QUOTE_DOCUMENT_PRINT = {
  orientation: "portrait",
  rootSelector: ".cust-doc-page",
  fragmentSelector: ".cust-doc",
} as const;

export function letterMarginDeclaration(orientation: LetterOrientation): string {
  const margin = LETTER_MARGIN_IN[orientation];
  return `${margin.top}in ${margin.right}in ${margin.bottom}in ${margin.left}in`;
}

export function letterContentBox(orientation: LetterOrientation): { widthPx: number; heightPx: number } {
  const margin = LETTER_MARGIN_IN[orientation];
  const paperWidth = orientation === "portrait" ? LETTER_PAPER_IN.width : LETTER_PAPER_IN.height;
  const paperHeight = orientation === "portrait" ? LETTER_PAPER_IN.height : LETTER_PAPER_IN.width;
  return {
    widthPx: (paperWidth - margin.left - margin.right) * LETTER_CSS_PX_PER_IN,
    heightPx: (paperHeight - margin.top - margin.bottom) * LETTER_CSS_PX_PER_IN,
  };
}

export function letterPrintClass(orientation: LetterOrientation, pages: number): (typeof LETTER_PRINT_CLASSES)[number] {
  return pages > 1 ? `letter-${orientation}-paged` : `letter-${orientation}`;
}

/** One fragment starts on its own page. A short piece is still one page. */
export function pagesForFragment(heightPx: number, pageHeightPx: number): number {
  if (!(pageHeightPx > 0) || !Number.isFinite(heightPx) || heightPx <= pageHeightPx) return 1;
  return Math.max(1, Math.ceil((heightPx - 0.5) / pageHeightPx));
}

export function pageCountFromFragmentHeights(heightsPx: readonly number[], pageHeightPx: number): number {
  if (heightsPx.length === 0) return 1;
  let pages = 0;
  for (const height of heightsPx) pages += pagesForFragment(height, pageHeightPx);
  return pages;
}

let prepareActive: (() => void) | null = null;

/** The open form registers this. Print buttons call it before `window.print()`. */
export function registerLetterPrint(prepare: () => void): () => void {
  prepareActive = prepare;
  return () => {
    if (prepareActive === prepare) prepareActive = null;
  };
}

export function prepareLetterPrint(): void {
  prepareActive?.();
}

export function measureLetterPages(
  root: HTMLElement,
  options: { orientation: LetterOrientation; fragmentSelector?: string },
): number {
  const box = letterContentBox(options.orientation);
  const host = document.createElement("div");
  host.setAttribute("data-letter-measure", "");
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.transform = "translateX(-120vw)";
  host.style.width = `${box.widthPx}px`;
  host.style.visibility = "hidden";
  host.style.pointerEvents = "none";
  const clone = root.cloneNode(true) as HTMLElement;
  clone.classList.add("letter-measure");
  clone.removeAttribute("id");
  for (const node of clone.querySelectorAll<HTMLElement>("[id]")) node.removeAttribute("id");
  host.append(clone);
  document.body.append(host);
  try {
    void clone.offsetHeight;
    const fragments = options.fragmentSelector
      ? [...clone.querySelectorAll<HTMLElement>(options.fragmentSelector)]
      : [];
    const heights = fragments.length > 0 ? fragments.map((element) => element.scrollHeight) : [clone.scrollHeight];
    return pageCountFromFragmentHeights(heights, box.heightPx);
  } finally {
    host.remove();
  }
}
