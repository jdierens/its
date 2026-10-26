"use client";

import { FastInput } from "@/components/FastField";
import { usePageMeta } from "@/components/AppShell";
import { errorText } from "@/lib/errors";
import { INVENTORY_NO_BINS, type InventoryHit } from "@/lib/inventorySearch";
import { searchInventory } from "@/lib/inventorySearchServer";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

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

export function InventorySearchPage() {
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const [identifier, setIdentifier] = useState(initial);
  const [edited, setEdited] = useState(Boolean(initial.trim()));
  const [hits, setHits] = useState<InventoryHit[]>([]);
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

  const listOpen = hits.length > 0;

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
              aria-activedescendant={active >= 0 ? `inventory-hit-${hits[active]?.id}` : undefined}
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
            <div className="receive-table-scroll">
              <table className="receive-table inventory-results" id="inventory-results">
                <thead>
                  <tr>
                    <th className="fit">SKU</th>
                    <th className="item">Item</th>
                    <th className="num fit">On hand</th>
                    <th className="locations">Bins</th>
                  </tr>
                </thead>
                <tbody>
                  {hits.map((hit, index) => (
                    <tr
                      key={hit.id}
                      id={`inventory-hit-${hit.id}`}
                      className={hit.empty ? "inventory-empty" : undefined}
                      aria-selected={index === active}
                    >
                      <td className="fit">
                        <Link href={`/items/${hit.id}`}>{hit.sku || "—"}</Link>
                      </td>
                      <td className="item">
                        <ItemCell hit={hit} />
                      </td>
                      <td className="num fit">{hit.qty}</td>
                      <td className="locations" title={hit.locations || undefined}>
                        {hit.empty ? INVENTORY_NO_BINS : hit.locations}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="receive-cards inventory-cards" aria-label="Inventory matches">
              {hits.map((hit, index) => (
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
                    <dd className="locations">{hit.empty ? INVENTORY_NO_BINS : hit.locations}</dd>
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
