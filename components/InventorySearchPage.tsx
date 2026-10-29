"use client";

import { FastInput } from "@/components/FastField";
import { usePageMeta } from "@/components/AppShell";
import { errorText } from "@/lib/errors";
import {
  INVENTORY_NO_BINS,
  sortInventoryHits,
  toggleInventorySort,
  type InventoryHit,
  type InventorySort,
  type InventorySortKey,
} from "@/lib/inventorySearch";
import { searchInventory } from "@/lib/inventorySearchServer";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const [identifier, setIdentifier] = useState(initial);
  const [edited, setEdited] = useState(Boolean(initial.trim()));
  const [hits, setHits] = useState<InventoryHit[]>([]);
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

  usePageMeta({
    title: "Inventory search",
    crumbs: [{ label: "Warehouse" }, { label: "Inventory search" }],
  });

  useEffect(() => {
    if (!edited) return;
    const query = identifier.trim();
    if (!query) {
      setHits([]);
      setActive(-1);
      setNote(null);
      setTruncated(false);
      setSettled("");
      setSearching(false);
      return;
    }
    wait.current = window.setTimeout(() => {
      void runSearch(query);
    }, 300);
    return () => {
      window.clearTimeout(wait.current);
      requestId.current += 1;
    };
  }, [edited, identifier]);

  const rows = useMemo(() => sortInventoryHits(hits, sort), [hits, sort]);

  async function runSearch(raw: string) {
    const query = raw.trim();
    if (!query) {
      setHits([]);
      setError("Enter a SKU, name, or description.");
      return;
    }
    const id = ++requestId.current;
    setSearching(true);
    setError(null);
    try {
      const result = await searchInventory(query);
      if (id !== requestId.current) return;
      if (typed.current.trim() !== query) return;
      if (!result.ok) {
        setHits([]);
        setError(result.message);
        return;
      }
      setNote(result.note);
      setTruncated(result.truncated);
      setSettled(query);
      setHits(result.hits);
      setActive(result.hits.length > 0 ? 0 : -1);
      if (result.hits.length === 0) setError("No items found");
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
      void runSearch(typed.current);
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

  const listOpen = rows.length > 0;

  return (
    <main className="page inventory-search-page">
      <p className="page-note">
        Same search as receiving. Each match shows the on-hand quantity and the bins that hold it.
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
              aria-expanded={listOpen}
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
        {listOpen ? (
          <>
            <div className="inventory-sort-bar" role="group" aria-label="Sort matches">
              <SortButton labelled label="SKU" column="sku" sort={sort} onSort={onColumnSort} />
              <SortButton labelled label="Item" column="item" sort={sort} onSort={onColumnSort} />
              <SortButton labelled label="On hand" column="qty" sort={sort} onSort={onColumnSort} />
              <SortButton labelled label="Bins" column="bins" sort={sort} onSort={onColumnSort} />
            </div>
            <div className="receive-table-scroll">
              <table className="receive-table inventory-results" id="inventory-results">
                <thead>
                  <tr>
                    <SortHeading label="SKU" column="sku" className="fit sku" sort={sort} onSort={onColumnSort} />
                    <SortHeading label="Item" column="item" className="item" sort={sort} onSort={onColumnSort} />
                    <SortHeading label="On hand" column="qty" className="num fit" sort={sort} onSort={onColumnSort} />
                    <SortHeading label="Bins" column="bins" className="locations" sort={sort} onSort={onColumnSort} />
                  </tr>
                </thead>
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
                      <td className="num fit">{hit.qty}</td>
                      <td className="locations" title={hit.locations || undefined}>
                        <BinLines text={hit.empty ? INVENTORY_NO_BINS : hit.locations} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                    <dd className="num">{hit.qty}</dd>
                    <dt>Bins</dt>
                    <dd className="locations" title={hit.locations || undefined}>
                      <BinLines text={hit.empty ? INVENTORY_NO_BINS : hit.locations} />
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </main>
  );
}
