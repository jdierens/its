"use client";

import { FastInput } from "@/components/FastField";
import { usePageMeta } from "@/components/AppShell";
import { errorText } from "@/lib/errors";
import {
  INVENTORY_NO_BINS,
  INVENTORY_STOCK_PARAM,
  inventoryStockMode,
  sortInventoryHits,
  toggleInventorySort,
  type InventoryHit,
  type InventorySort,
  type InventorySortKey,
  type InventoryStock,
} from "@/lib/inventorySearch";
import { searchInventory } from "@/lib/inventorySearchServer";
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

function OnHandQty({ hit }: { hit: InventoryHit }) {
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

function stockModeLabel(stock: InventoryStock): string {
  return stock === "in" ? "In stock" : "All";
}

/** Names the current mode and what a click does. The visible text is the mode. */
function stockModeName(stock: InventoryStock): string {
  return stock === "in"
    ? "On hand filter: in stock only. Show all quantities, including zero."
    : "On hand filter: all quantities. Show in stock only.";
}

/**
 * On hand still sorts. The mode beside it toggles in stock only and all.
 * Both sit on the quantity heading, including the phone sort bar.
 */
function OnHandControls({
  sort,
  stock,
  onSort,
  onStock,
  labelled = false,
}: {
  sort: InventorySort | null;
  stock: InventoryStock;
  onSort: (key: InventorySortKey) => void;
  onStock: () => void;
  labelled?: boolean;
}) {
  return (
    <div className="inventory-qty-head">
      <SortButton labelled={labelled} label="On hand" column="qty" sort={sort} onSort={onSort} />
      <button
        type="button"
        className="inventory-stock"
        aria-pressed={stock === "in"}
        aria-label={stockModeName(stock)}
        title={stockModeName(stock)}
        onClick={onStock}
      >
        {stockModeLabel(stock)}
      </button>
    </div>
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

/** One block per bin so a location code cannot wrap after a period. */
function BinLines({ text }: { text: string }) {
  return text.split("\n").map((line, index) => (
    <span className="inventory-bin" key={index}>
      {line}
    </span>
  ));
}

export function InventorySearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const stock = inventoryStockMode(params.get(INVENTORY_STOCK_PARAM));
  const [identifier, setIdentifier] = useState(initial);
  const [edited, setEdited] = useState(Boolean(initial.trim()));
  const [hits, setHits] = useState<InventoryHit[]>([]);
  const [matched, setMatched] = useState(0);
  const [sort, setSort] = useState<InventorySort | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [active, setActive] = useState(-1);
  const [settled, setSettled] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const wait = useRef(0);
  const typed = useRef(initial);
  const stockRef = useRef(stock);
  const stockImmediate = useRef(false);
  stockRef.current = stock;

  usePageMeta({
    title: "Inventory search",
    crumbs: [{ label: "Warehouse" }, { label: "Inventory search" }],
  });

  useEffect(() => {
    const immediate = stockImmediate.current;
    stockImmediate.current = false;
    if (!edited) return;
    const query = identifier.trim();
    if (!query) {
      setHits([]);
      setMatched(0);
      setActive(-1);
      setNote(null);
      setTruncated(false);
      setSettled("");
      setSearching(false);
      return;
    }
    wait.current = window.setTimeout(() => {
      void runSearch(query, stock);
    }, immediate ? 0 : 300);
    return () => {
      window.clearTimeout(wait.current);
      requestId.current += 1;
    };
  }, [edited, identifier, stock]);

  const rows = useMemo(() => sortInventoryHits(hits, sort), [hits, sort]);

  async function runSearch(raw: string, mode: InventoryStock) {
    const query = raw.trim();
    if (!query) {
      setHits([]);
      setMatched(0);
      setError("Enter a SKU, name, or description.");
      return;
    }
    const id = ++requestId.current;
    setSearching(true);
    setError(null);
    try {
      const result = await searchInventory(query, mode);
      if (id !== requestId.current) return;
      if (typed.current.trim() !== query) return;
      if (stockRef.current !== mode) return;
      if (!result.ok) {
        setHits([]);
        setMatched(0);
        setError(result.message);
        return;
      }
      setNote(result.note);
      setTruncated(result.truncated);
      setSettled(query);
      setMatched(result.matched);
      setHits(result.hits);
      setActive(result.hits.length > 0 ? 0 : -1);
      if (result.hits.length === 0 && result.matched === 0) setError("No items found");
    } catch (cause) {
      if (id === requestId.current) setError(errorText(cause));
    } finally {
      if (id === requestId.current) setSearching(false);
    }
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      window.clearTimeout(wait.current);
      void runSearch(typed.current, stock);
      return;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && rows.length > 0 && settled === typed.current.trim()) {
      event.preventDefault();
      setActive((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        if (next < 0) return rows.length - 1;
        if (next >= rows.length) return 0;
        return next;
      });
    }
  }

  function onColumnSort(key: InventorySortKey) {
    setSort((current) => toggleInventorySort(current, key));
    if (hits.length > 0) setActive(0);
  }

  function onStock() {
    const next = new URLSearchParams(params.toString());
    const typedQuery = identifier.trim();
    if (typedQuery) next.set("q", typedQuery);
    else next.delete("q");
    if (stock === "in") next.set(INVENTORY_STOCK_PARAM, "all");
    else next.delete(INVENTORY_STOCK_PARAM);
    const query = next.toString();
    stockImmediate.current = true;
    setHits([]);
    setMatched(0);
    setActive(-1);
    setError(null);
    setNote(null);
    setTruncated(false);
    if (settled) setSearching(true);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const stockEmpty = Boolean(settled) && !searching && !error && stock === "in" && matched > 0 && rows.length === 0;
  const showFrame = rows.length > 0 || (Boolean(settled) && searching) || stockEmpty;

  return (
    <main className="page inventory-search-page">
      <p className="page-note">
        Same search as receiving. On hand is quantity for sale. Damaged pieces stay in the bin and are not
        included. On hand starts at in stock only.
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
              aria-activedescendant={active >= 0 ? `inventory-hit-${rows[active]?.id}` : undefined}
              onDraft={(value) => {
                typed.current = value;
              }}
              onValue={(value) => {
                typed.current = value;
                if (value === identifier) return;
                setEdited(true);
                setIdentifier(value);
                setHits([]);
                setMatched(0);
                setActive(-1);
                setNote(null);
                setTruncated(false);
                setSettled("");
                setError(null);
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
          <p className="hint">No on-hand quantity for this search. On hand is set to in stock only.</p>
        ) : null}
        {showFrame ? (
          <>
            <div className="inventory-sort-bar" role="group" aria-label="Sort matches and on-hand filter">
              <SortButton labelled label="SKU" column="sku" sort={sort} onSort={onColumnSort} />
              <SortButton labelled label="Item" column="item" sort={sort} onSort={onColumnSort} />
              <OnHandControls labelled sort={sort} stock={stock} onSort={onColumnSort} onStock={onStock} />
              <SortButton labelled label="Bins" column="bins" sort={sort} onSort={onColumnSort} />
            </div>
            <div className="receive-table-scroll">
              <table className="receive-table inventory-results" id="inventory-results">
                <thead>
                  <tr>
                    <SortHeading label="SKU" column="sku" className="fit sku" sort={sort} onSort={onColumnSort} />
                    <SortHeading label="Item" column="item" className="item" sort={sort} onSort={onColumnSort} />
                    <th
                      className="num fit"
                      scope="col"
                      aria-sort={
                        sortDirection(sort, "qty") === "asc"
                          ? "ascending"
                          : sortDirection(sort, "qty") === "desc"
                            ? "descending"
                            : "none"
                      }
                    >
                      <OnHandControls sort={sort} stock={stock} onSort={onColumnSort} onStock={onStock} />
                    </th>
                    <SortHeading label="Bins" column="bins" className="locations" sort={sort} onSort={onColumnSort} />
                  </tr>
                </thead>
                {rows.length > 0 ? (
                <tbody>
                  {rows.map((hit, index) => (
                    <tr
                      key={hit.id}
                      id={`inventory-hit-${hit.id}`}
                      className={hit.empty ? "inventory-empty" : undefined}
                      aria-selected={index === active}
                    >
                      <td className="fit sku">
                        <Link href={`/items/${hit.id}`}>{hit.sku || "—"}</Link>
                      </td>
                      <td className="item">
                        <ItemCell hit={hit} />
                      </td>
                      <td className="num fit">
                        <OnHandQty hit={hit} />
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
            {rows.length > 0 ? (
            <ul className="receive-cards inventory-cards" aria-label="Inventory matches">
              {rows.map((hit, index) => (
                <li
                  key={hit.id}
                  className={hit.empty ? "receive-card-row inventory-empty" : "receive-card-row"}
                  aria-selected={index === active}
                >
                  <dl>
                    <dt>SKU</dt>
                    <dd>
                      <Link href={`/items/${hit.id}`}>{hit.sku || "—"}</Link>
                    </dd>
                    <dt>Item</dt>
                    <dd>
                      <ItemCell hit={hit} />
                    </dd>
                    <dt>On hand</dt>
                    <dd className="num">
                      <OnHandQty hit={hit} />
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
