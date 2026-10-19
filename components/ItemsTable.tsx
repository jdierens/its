"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { errorText } from "@/lib/errors";
import { fetchItemList, fetchTaxonomyChoices } from "@/lib/items";
import { fetchManufacturerChoices } from "@/lib/manufacturers";
import type { ItemListColumn, ItemListRow, TaxonomyChoice } from "@/lib/types";

type ActiveCell = { row: number; col: number };

const BASE_COLUMNS = [
  { id: "photo", label: "Photo" },
  { id: "sku", label: "SKU" },
  { id: "name", label: "Name" },
  { id: "manufacturer", label: "Manufacturer" },
  { id: "model", label: "Model" },
  { id: "part_number", label: "Part number" },
  { id: "condition", label: "Condition" },
  { id: "taxonomy", label: "Taxonomy" },
  { id: "quantity", label: "Quantity" },
] as const;

function fieldSummary(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([name, value]) => `${name} ${value}`)
    .join(" · ");
}

function columnLabel(column: ItemListColumn): string {
  return column.unit ? `${column.name} (${column.unit})` : column.name;
}

export function ItemsTable() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tax = (params.get("tax") ?? "").trim().toUpperCase();
  const q = params.get("q") ?? "";
  const conditionParam = params.get("condition") ?? "";
  const condition = conditionParam === "New" || conditionParam === "Used" ? conditionParam : "";
  const manufacturerId = params.get("mfr") ?? "";
  const [draft, setDraft] = useState(q);
  const [choices, setChoices] = useState<TaxonomyChoice[]>([]);
  const [manufacturers, setManufacturers] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<ItemListRow[]>([]);
  const [columns, setColumns] = useState<ItemListColumn[]>([]);
  const [total, setTotal] = useState(0);
  const [unknownTax, setUnknownTax] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveCell | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());

  const gridColumns = useMemo(() => {
    const extra =
      columns.length > 0
        ? columns.map((column) => ({ id: `attr:${column.name}`, label: columnLabel(column) }))
        : [{ id: "fields", label: "Fields" }];
    return [...BASE_COLUMNS, ...extra];
  }, [columns]);

  useEffect(() => {
    setDraft(q);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTaxonomyChoices(), fetchManufacturerChoices()])
      .then(([nextChoices, nextMakers]) => {
        if (cancelled) return;
        setChoices(nextChoices);
        setManufacturers(nextMakers);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const trimmed = draft.trim();
      if (trimmed === q) return;
      const next = new URLSearchParams(params.toString());
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [draft, q, params, pathname, router]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchItemList({ tax, q, condition, manufacturerId })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setColumns(result.columns);
        setTotal(result.total);
        setUnknownTax(result.unknownTax);
        setError(null);
        setActive((current) => {
          if (!current) return null;
          if (current.row >= result.rows.length) return null;
          return current;
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tax, q, condition, manufacturerId]);

  useEffect(() => {
    if (!active) return;
    const cell = cellRefs.current.get(`${active.row}:${active.col}`);
    if (!cell) return;
    if (document.activeElement !== cell) cell.focus();
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, rows, gridColumns]);

  useEffect(() => {
    function onSlash(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, []);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function move(row: number, col: number) {
    if (rows.length === 0 || gridColumns.length === 0) return;
    const next = {
      row: Math.max(0, Math.min(rows.length - 1, row)),
      col: Math.max(0, Math.min(gridColumns.length - 1, col)),
    };
    setActive(next);
  }

  function onGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setActive(null);
      (event.target as HTMLElement).blur();
      return;
    }
    if (rows.length === 0) return;

    const row = active?.row ?? 0;
    const col = active?.col ?? 0;
    const pageSize = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 300) / 30) - 1);

    if (event.key === "ArrowDown") move(active ? row + 1 : 0, col);
    else if (event.key === "ArrowUp") move(active ? row - 1 : rows.length - 1, col);
    else if (event.key === "ArrowRight") move(active ? row : 0, active ? col + 1 : 0);
    else if (event.key === "ArrowLeft") move(active ? row : 0, active ? col - 1 : gridColumns.length - 1);
    else if (event.key === "Home") move(active ? row : 0, 0);
    else if (event.key === "End") move(active ? row : 0, gridColumns.length - 1);
    else if (event.key === "PageDown") move((active ? row : 0) + pageSize, col);
    else if (event.key === "PageUp") move((active ? row : 0) - pageSize, col);
    else if (event.key === "Enter" && active) {
      router.push(`/items/${rows[active.row].id}`);
    } else {
      return;
    }
    event.preventDefault();
  }

  function cellText(item: ItemListRow, columnId: string): string {
    if (columnId === "sku") return item.sku || "—";
    if (columnId === "name") return item.name || "Untitled";
    if (columnId === "manufacturer") return item.manufacturerName || "—";
    if (columnId === "model") return item.model || "—";
    if (columnId === "part_number") return item.partNumber || "—";
    if (columnId === "condition") return item.condition || "—";
    if (columnId === "quantity") return item.quantity === null ? "—" : String(item.quantity);
    if (columnId === "fields") return fieldSummary(item.fields) || "—";
    if (columnId.startsWith("attr:")) return item.fields[columnId.slice(5)] || "—";
    return "";
  }

  const knownTax = choices.some((choice) => choice.shortCode === tax);

  return (
    <main className="page items-page">
      <div className="items-toolbar">
        <select
          aria-label="Filter by taxonomy"
          value={knownTax ? tax : ""}
          onChange={(event) => setParam("tax", event.target.value)}
        >
          <option value="">All taxonomies</option>
          {choices.map((choice) => (
            <option key={choice.shortCode} value={choice.shortCode}>
              {choice.shortCode} — {choice.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by condition"
          value={condition}
          onChange={(event) => setParam("condition", event.target.value)}
        >
          <option value="">All conditions</option>
          <option value="New">New</option>
          <option value="Used">Used</option>
        </select>
        <select
          aria-label="Filter by manufacturer"
          value={manufacturers.some((maker) => maker.id === manufacturerId) ? manufacturerId : ""}
          onChange={(event) => setParam("mfr", event.target.value)}
        >
          <option value="">All manufacturers</option>
          {manufacturers.map((maker) => (
            <option key={maker.id} value={maker.id}>
              {maker.name}
            </option>
          ))}
        </select>
        <input
          ref={searchRef}
          className="items-search"
          type="search"
          aria-label="Search items"
          placeholder="Search SKU, name, manufacturer, model, part number"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (draft) setDraft("");
              else event.currentTarget.blur();
            }
          }}
        />
        <p className="items-count">
          {loading && rows.length === 0 ? "Loading items…" : `${rows.length} of ${total} items`}
        </p>
        <Link className="button" href="/items/new">
          New item
        </Link>
      </div>
      <p id="items-help" className="hint items-help">
        Arrow keys move the cell, Enter opens the item, and / focuses search.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {unknownTax ? (
        <p className="banner error">No taxonomy uses the short code {tax}.</p>
      ) : null}
      <div
        ref={scrollRef}
        className="items-scroll"
        tabIndex={active ? -1 : 0}
        onKeyDown={onGridKeyDown}
      >
        <table
          className="items-grid"
          role="grid"
          aria-label="Items"
          aria-describedby="items-help"
          aria-rowcount={rows.length + 1}
          aria-colcount={gridColumns.length}
          aria-busy={loading}
        >
          <thead>
            <tr role="row" aria-rowindex={1}>
              {gridColumns.map((column, index) => (
                <th key={column.id} role="columnheader" aria-colindex={index + 1} scope="col">
                  {column.id === "photo" ? <span className="sr-only">Photo</span> : column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((item, rowIndex) => {
              const rowSelected = active?.row === rowIndex;
              return (
                <tr
                  key={item.id}
                  role="row"
                  aria-rowindex={rowIndex + 2}
                  aria-selected={rowSelected}
                >
                  {gridColumns.map((column, colIndex) => {
                    const selected = rowSelected && active?.col === colIndex;
                    return (
                      <td
                        key={column.id}
                        ref={(node) => {
                          const key = `${rowIndex}:${colIndex}`;
                          if (node) cellRefs.current.set(key, node);
                          else cellRefs.current.delete(key);
                        }}
                        role="gridcell"
                        aria-colindex={colIndex + 1}
                        aria-selected={selected}
                        tabIndex={selected ? 0 : -1}
                        className={
                          column.id === "name" ||
                          column.id === "fields" ||
                          column.id === "manufacturer" ||
                          column.id === "model" ||
                          column.id === "part_number"
                            ? "clip"
                            : undefined
                        }
                        onClick={() => setActive({ row: rowIndex, col: colIndex })}
                        onDoubleClick={() => router.push(`/items/${item.id}`)}
                      >
                        {column.id === "photo" ? (
                          item.imageUrl ? (
                            <img className="thumb-sm" src={item.imageUrl} alt="" />
                          ) : (
                            <span className="thumb-empty" aria-hidden>
                              —
                            </span>
                          )
                        ) : column.id === "taxonomy" ? (
                          item.shortCode ? (
                            <span className="code-badge">{item.shortCode}</span>
                          ) : (
                            "—"
                          )
                        ) : (
                          cellText(item, column.id)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 ? <p className="items-empty">No items match.</p> : null}
      </div>
    </main>
  );
}
