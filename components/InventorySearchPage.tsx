"use client";

import { FastInput } from "@/components/FastField";
import { usePageMeta } from "@/components/AppShell";
import { errorText } from "@/lib/errors";
import {
  INVENTORY_DIR_PARAM,
  INVENTORY_NO_BINS,
  INVENTORY_PAGE_PARAM,
  INVENTORY_PAGE_SIZE,
  INVENTORY_SORT_PARAM,
  INVENTORY_STOCK_PARAM,
  inventoryPageWindow,
  inventoryStockMode,
  parseInventoryPage,
  parseInventorySort,
  toggleInventorySort,
  type InventoryHit,
  type InventorySort,
  type InventorySortKey,
  type InventoryStock,
} from "@/lib/inventorySearch";
import { searchInventory } from "@/lib/inventorySearchServer";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

function sortDirection(sort: InventorySort | null, column: InventorySortKey): InventorySort["dir"] | null {
  return sort?.key === column ? sort.dir : null;
}

function SortButton({
  label,
  column,
  sort,
  onSort,
  labelled = false,
}: {
  label: string;
  column: InventorySortKey;
  sort: InventorySort | null;
  onSort: (key: InventorySortKey) => void;
  /** Mobile bar has no column header, so the button name includes the direction. */
  labelled?: boolean;
}) {
  const direction = sortDirection(sort, column);
  const directionName = direction === "asc" ? "ascending" : "descending";
  return (
    <button
      type="button"
      className="inventory-col-sort"
      title={`Sort by ${label}`}
      aria-label={labelled ? (direction ? `Sort by ${label}, ${directionName}` : `Sort by ${label}`) : undefined}
      onClick={() => onSort(column)}
    >
      {label}
      {direction ? <span aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span> : null}
    </button>
  );
}

function SortHeading({
  label,
  column,
  className,
  sort,
  onSort,
}: {
  label: string;
  column: InventorySortKey;
  className: string;
  sort: InventorySort | null;
  onSort: (key: InventorySortKey) => void;
}) {
  const direction = sortDirection(sort, column);
  return (
    <th className={className} scope="col" aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}>
      <SortButton label={label} column={column} sort={sort} onSort={onSort} />
    </th>
  );
}

/** Names the current qty filter and what a click does. The visible word is Qty. */
function qtyToggleName(stock: InventoryStock): string {
  return stock === "in" ? "Qty, in stock only. Show all quantities." : "Qty, all quantities. Show in stock only.";
}

/**
 * Qty is the filter. Click it to switch in stock only and all quantities.
 * The arrow beside it sorts. Neither control says "on hand".
 */
function QtyControls({
  sort,
  stock,
  onSort,
  onStock,
}: {
  sort: InventorySort | null;
  stock: InventoryStock;
  onSort: (key: InventorySortKey) => void;
  onStock: () => void;
}) {
  const direction = sortDirection(sort, "qty");
  const directionName = direction === "asc" ? "ascending" : "descending";
  return (
    <div className="inventory-qty-head">
      <button
        type="button"
        className="inventory-qty-toggle"
        aria-pressed={stock === "in"}
        aria-label={qtyToggleName(stock)}
        title={qtyToggleName(stock)}
        onClick={onStock}
      >
        Qty
      </button>
      <button
        type="button"
        className="inventory-col-sort inventory-qty-sort"
        title="Sort by Qty"
        aria-label={direction ? `Sort by Qty, ${directionName}` : "Sort by Qty"}
        onClick={() => onSort("qty")}
      >
        <span aria-hidden="true">{direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}</span>
      </button>
    </div>
  );
}

function QtyHeading({
  sort,
  stock,
  onSort,
  onStock,
}: {
  sort: InventorySort | null;
  stock: InventoryStock;
  onSort: (key: InventorySortKey) => void;
  onStock: () => void;
}) {
  const direction = sortDirection(sort, "qty");
  return (
    <th
      className="num fit"
      scope="col"
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
    >
      <QtyControls sort={sort} stock={stock} onSort={onSort} onStock={onStock} />
    </th>
  );
}

function ItemCell({ hit }: { hit: InventoryHit }) {
  const description = hit.description.trim();
  return (
    <>
      <div>{hit.name || "—"}</div>
      {description ? (
        <div className="inventory-item-desc" title={description}>
          {description}
        </div>
      ) : null}
    </>
  );
}

/** Short code, the same badge as the items list. Long code and name stay on the tooltip. */
function TaxonomyCell({ hit }: { hit: InventoryHit }) {
  const short = hit.shortCode?.trim() ?? "";
  const long = hit.longCode?.trim() ?? "";
  const name = hit.taxonomyName?.trim() ?? "";
  const title = [long, name].filter(Boolean).join(" · ") || undefined;
  if (short) return <span className="code-badge" title={title}>{short}</span>;
  if (long) return <span title={name || undefined}>{long}</span>;
  if (name) return <span>{name}</span>;
  return "—";
}

function PhotoCell({ hit }: { hit: InventoryHit }) {
  if (!hit.imageUrl) {
    return (
      <span className="thumb-empty" aria-hidden>
        —
      </span>
    );
  }
  return <img className="thumb-sm" src={hit.imageUrl} alt="" />;
}

function QtyCell({ hit }: { hit: InventoryHit }) {
  if (hit.damaged <= 0) return hit.qty;
  const where = hit.damagedLocations.split("\n").join(", ");
  return (
    <>
      {hit.qty}
      <span className="inventory-damaged" title={where || undefined}>
        {hit.damaged} damaged
      </span>
    </>
  );
}

/** One block per bin so a location code cannot wrap after a period. */
function BinLines({ text }: { text: string }) {
  return text.split("\n").map((line, index) => (
    <span className="inventory-bin" key={index}>
      {line}
    </span>
  ));
}

function InventoryPager({
  page,
  pages,
  from,
  to,
  matched,
  loading,
  onPage,
}: {
  page: number;
  pages: number;
  from: number;
  to: number;
  matched: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <nav className="receive-pager" aria-label="Pages">
      <button
        type="button"
        className="secondary"
        aria-label="First page"
        title="First page"
        disabled={loading || page <= 1}
        onClick={() => onPage(1)}
      >
        <ChevronsLeft size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className="secondary"
        aria-label="Previous page"
        title="Previous page"
        disabled={loading || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className="secondary"
        aria-label="Next page"
        title="Next page"
        disabled={loading || page >= pages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className="secondary"
        aria-label="Last page"
        title="Last page"
        disabled={loading || page >= pages}
        onClick={() => onPage(pages)}
      >
        <ChevronsRight size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <span className="hint">
        {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} of {matched.toLocaleString("en-US")}
      </span>
    </nav>
  );
}

function writeQuery(params: URLSearchParams, identifier: string) {
  const typedQuery = identifier.trim();
  if (typedQuery) params.set("q", typedQuery);
  else params.delete("q");
}

export function InventorySearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const stock = inventoryStockMode(params.get(INVENTORY_STOCK_PARAM));
  const page = parseInventoryPage(params.get(INVENTORY_PAGE_PARAM));
  const sortKey = params.get(INVENTORY_SORT_PARAM);
  const sortDir = params.get(INVENTORY_DIR_PARAM);
  const sort = useMemo(() => parseInventorySort(sortKey, sortDir), [sortKey, sortDir]);
  const [identifier, setIdentifier] = useState(initial);
  const [hits, setHits] = useState<InventoryHit[]>([]);
  const [matched, setMatched] = useState(0);
  const [scanned, setScanned] = useState(0);
  const [totalQty, setTotalQty] = useState(0);
  const [pages, setPages] = useState(1);
  const [note, setNote] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [active, setActive] = useState(-1);
  const [settled, setSettled] = useState("");
  const [searching, setSearching] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const wait = useRef(0);
  const typed = useRef(initial);
  const stockRef = useRef(stock);
  const pageRef = useRef(page);
  const sortRef = useRef(sort);
  const navImmediate = useRef(false);
  const first = useRef(true);
  stockRef.current = stock;
  pageRef.current = page;
  sortRef.current = sort;

  usePageMeta({
    title: "Inventory search",
    crumbs: [{ label: "Warehouse" }, { label: "Inventory search" }],
  });

  useEffect(() => {
    const immediate = navImmediate.current || first.current;
    navImmediate.current = false;
    const query = identifier.trim();
    const requestedPage = page;
    const requestedSort = sort;
    const requestedStock = stock;
    wait.current = window.setTimeout(() => {
      first.current = false;
      void runSearch(query, requestedStock, requestedPage, requestedSort);
    }, immediate ? 0 : 300);
    return () => {
      window.clearTimeout(wait.current);
      requestId.current += 1;
    };
  }, [identifier, stock, page, sort]);

  async function runSearch(raw: string, mode: InventoryStock, requestedPage: number, ordering: InventorySort | null) {
    const query = raw.trim();
    const id = ++requestId.current;
    setSearching(true);
    setError(null);
    try {
      const result = await searchInventory(query, mode, requestedPage, ordering);
      if (id !== requestId.current) return;
      if (typed.current.trim() !== query) return;
      if (stockRef.current !== mode) return;
      if (pageRef.current !== requestedPage) return;
      if ((sortRef.current?.key ?? null) !== (ordering?.key ?? null)) return;
      if ((sortRef.current?.dir ?? null) !== (ordering?.dir ?? null)) return;
      if (!result.ok) {
        setHits([]);
        setMatched(0);
        setScanned(0);
        setTotalQty(0);
        setPages(1);
        setError(result.message);
        return;
      }
      setNote(result.note);
      setTruncated(result.truncated);
      setSettled(query);
      setMatched(result.matched);
      setScanned(result.scanned);
      setTotalQty(result.totalQty);
      setPages(result.pages);
      setHits(result.hits);
      setActive(result.hits.length > 0 ? 0 : -1);
      setReady(true);
      if (query && result.scanned === 0 && result.matched === 0) setError("No items found");
      const next = new URLSearchParams(params.toString());
      let changed = false;
      if (query) {
        if (next.get("q") !== query) {
          next.set("q", query);
          changed = true;
        }
      } else if (next.has("q")) {
        next.delete("q");
        changed = true;
      }
      if (result.page !== requestedPage) {
        if (result.page <= 1) next.delete(INVENTORY_PAGE_PARAM);
        else next.set(INVENTORY_PAGE_PARAM, String(result.page));
        changed = true;
        navImmediate.current = true;
      }
      if (changed) {
        const search = next.toString();
        router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
      }
    } catch (cause) {
      if (id === requestId.current) setError(errorText(cause));
    } finally {
      if (id === requestId.current) setSearching(false);
    }
  }

  function replaceParams(next: URLSearchParams) {
    const search = next.toString();
    navImmediate.current = true;
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      window.clearTimeout(wait.current);
      if (page !== 1) {
        const next = new URLSearchParams(params.toString());
        writeQuery(next, typed.current);
        next.delete(INVENTORY_PAGE_PARAM);
        replaceParams(next);
        return;
      }
      void runSearch(typed.current, stock, page, sort);
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && hits.length > 0 && settled === typed.current.trim()) {
      event.preventDefault();
      setActive((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        if (next < 0) return hits.length - 1;
        if (next >= hits.length) return 0;
        return next;
      });
    }
  }

  function onColumnSort(key: InventorySortKey) {
    const nextSort = toggleInventorySort(sort, key);
    const next = new URLSearchParams(params.toString());
    writeQuery(next, identifier);
    next.set(INVENTORY_SORT_PARAM, nextSort.key);
    next.set(INVENTORY_DIR_PARAM, nextSort.dir);
    next.delete(INVENTORY_PAGE_PARAM);
    if (hits.length > 0) setActive(0);
    replaceParams(next);
  }

  function onStock() {
    const next = new URLSearchParams(params.toString());
    writeQuery(next, identifier);
    if (stock === "in") next.set(INVENTORY_STOCK_PARAM, "all");
    else next.delete(INVENTORY_STOCK_PARAM);
    next.delete(INVENTORY_PAGE_PARAM);
    setError(null);
    replaceParams(next);
  }

  function onPage(nextPage: number) {
    const next = new URLSearchParams(params.toString());
    writeQuery(next, identifier);
    if (nextPage <= 1) next.delete(INVENTORY_PAGE_PARAM);
    else next.set(INVENTORY_PAGE_PARAM, String(nextPage));
    setActive(0);
    replaceParams(next);
  }

  const pageWindow = inventoryPageWindow(matched, page, INVENTORY_PAGE_SIZE);
  const stockEmpty = ready && !searching && !error && stock === "in" && scanned > 0 && matched === 0;
  const showFrame = ready || searching || hits.length > 0;

  return (
    <main className="page inventory-search-page">
      <p className="page-note">
        Same search as receiving. Leave the box blank to list the inventory. Qty is for sale and starts at in
        stock only; click Qty to include zeros. Damaged pieces stay in the bin and are not included.
      </p>
      <section className="card" aria-busy={searching}>
        <div className="inventory-search-field">
          <label htmlFor="inventory-search">
            <span>Search</span>
            <FastInput
              id="inventory-search"
              value={identifier}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              placeholder="SKU, name, part number, or description"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showFrame}
              aria-controls="inventory-results"
              aria-busy={searching}
              aria-activedescendant={active >= 0 ? `inventory-hit-${hits[active]?.id}` : undefined}
              onDraft={(value) => {
                typed.current = value;
              }}
              onValue={(value) => {
                typed.current = value;
                if (value === identifier) return;
                setIdentifier(value);
                setError(null);
                if (page !== 1) {
                  const next = new URLSearchParams(params.toString());
                  writeQuery(next, value);
                  next.delete(INVENTORY_PAGE_PARAM);
                  replaceParams(next);
                }
              }}
              onKeyDown={onSearchKey}
            />
          </label>
        </div>
        {note ? <p className="hint">{note}</p> : null}
        {truncated ? <p className="hint">Showing the first matches. Type more to narrow them.</p> : null}
        {searching ? <p className="hint">Searching…</p> : null}
        {error ? (
          <p className="banner error" role="alert">
            {error}
          </p>
        ) : null}
        {stockEmpty ? (
          <p className="hint">No in-stock quantity for this search. Qty is set to in stock only.</p>
        ) : null}
        {showFrame ? (
          <>
            {ready ? (
              <div className="inventory-meta">
                <p className="inventory-summary" aria-live="polite">
                  <strong>{matched.toLocaleString("en-US")}</strong> {matched === 1 ? "result" : "results"}
                  <span aria-hidden="true"> · </span>
                  total qty <strong>{totalQty.toLocaleString("en-US")}</strong>
                  <span className="hint">for this filter, not this page</span>
                </p>
                <InventoryPager
                  page={page}
                  pages={pages}
                  from={pageWindow.from}
                  to={pageWindow.to}
                  matched={matched}
                  loading={searching}
                  onPage={onPage}
                />
              </div>
            ) : null}
            <div className="inventory-sort-bar" role="group" aria-label="Sort results">
              <SortButton labelled label="Photo" column="photo" sort={sort} onSort={onColumnSort} />
              <SortButton labelled label="SKU" column="sku" sort={sort} onSort={onColumnSort} />
              <SortButton labelled label="Item" column="item" sort={sort} onSort={onColumnSort} />
              <SortButton labelled label="Taxo" column="taxo" sort={sort} onSort={onColumnSort} />
              <QtyControls sort={sort} stock={stock} onSort={onColumnSort} onStock={onStock} />
              <SortButton labelled label="Bins" column="bins" sort={sort} onSort={onColumnSort} />
            </div>
            <div className="receive-table-scroll">
              <table className="receive-table inventory-results" id="inventory-results">
                <thead>
                  <tr>
                    <SortHeading label="Photo" column="photo" className="photo" sort={sort} onSort={onColumnSort} />
                    <SortHeading label="SKU" column="sku" className="fit sku" sort={sort} onSort={onColumnSort} />
                    <SortHeading label="Item" column="item" className="item" sort={sort} onSort={onColumnSort} />
                    <SortHeading label="Taxo" column="taxo" className="taxo fit" sort={sort} onSort={onColumnSort} />
                    <QtyHeading sort={sort} stock={stock} onSort={onColumnSort} onStock={onStock} />
                    <SortHeading label="Bins" column="bins" className="locations" sort={sort} onSort={onColumnSort} />
                  </tr>
                </thead>
                {hits.length > 0 ? (
                  <tbody>
                    {hits.map((hit, index) => (
                      <tr
                        key={hit.id}
                        id={`inventory-hit-${hit.id}`}
                        className={hit.empty ? "inventory-empty" : undefined}
                        aria-selected={index === active}
                      >
                        <td className="photo">
                          <PhotoCell hit={hit} />
                        </td>
                        <td className="fit sku">
                          <Link href={`/items/${hit.id}`}>{hit.sku || "—"}</Link>
                        </td>
                        <td className="item">
                          <ItemCell hit={hit} />
                        </td>
                        <td className="taxo">
                          <TaxonomyCell hit={hit} />
                        </td>
                        <td className="num fit">
                          <QtyCell hit={hit} />
                        </td>
                        <td className="locations" title={hit.locations || undefined}>
                          <BinLines text={hit.empty ? INVENTORY_NO_BINS : hit.locations} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ) : null}
              </table>
            </div>
            {hits.length > 0 ? (
              <ul className="receive-cards inventory-cards" aria-label="Inventory matches">
                {hits.map((hit, index) => (
                  <li
                    key={hit.id}
                    className={hit.empty ? "receive-card-row inventory-empty" : "receive-card-row"}
                    aria-selected={index === active}
                  >
                    <dl>
                      <dt>Photo</dt>
                      <dd className="inventory-photo">
                        <PhotoCell hit={hit} />
                      </dd>
                      <dt>SKU</dt>
                      <dd>
                        <Link href={`/items/${hit.id}`}>{hit.sku || "—"}</Link>
                      </dd>
                      <dt>Item</dt>
                      <dd>
                        <ItemCell hit={hit} />
                      </dd>
                      <dt>Taxo</dt>
                      <dd>
                        <TaxonomyCell hit={hit} />
                      </dd>
                      <dt>Qty</dt>
                      <dd className="num">
                        <QtyCell hit={hit} />
                      </dd>
                      <dt>Bins</dt>
                      <dd className="locations" title={hit.locations || undefined}>
                        <BinLines text={hit.empty ? INVENTORY_NO_BINS : hit.locations} />
                      </dd>
                    </dl>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
