const KEY = "its.items.return";

export type ItemsReturn = {
  href: string;
  scroll: number;
};

/** Only the items list, with its query string. An item path is not a return target. */
export function safeItemsHref(href: string | null | undefined): string {
  if (!href) return "/items";
  if (href === "/items" || href.startsWith("/items?")) return href;
  return "/items";
}

function read(): ItemsReturn | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ItemsReturn>;
    if (!parsed || typeof parsed.href !== "string") return null;
    const scroll = typeof parsed.scroll === "number" && Number.isFinite(parsed.scroll) ? parsed.scroll : 0;
    return { href: parsed.href, scroll };
  } catch {
    return null;
  }
}

export function rememberItemsList(href: string, scroll: number) {
  if (typeof sessionStorage === "undefined") return;
  const payload: ItemsReturn = {
    href,
    scroll: Number.isFinite(scroll) && scroll > 0 ? scroll : 0,
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Private mode can reject storage. The back link then goes to /items.
  }
}

export function itemsListHref(): string {
  return safeItemsHref(read()?.href);
}

export function peekItemsScroll(href: string): number | null {
  const saved = read();
  if (!saved || saved.href !== href) return null;
  return saved.scroll;
}

export function clearItemsReturn() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Ignore. A later visit can still restore.
  }
}
