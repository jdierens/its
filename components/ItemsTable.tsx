"use client";

import Link from "next/link";
import { ItemExportMenu } from "@/components/ItemExportMenu";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { BulkEditBar, type BulkField } from "@/components/BulkEditBar";
import { CellEditor } from "@/components/CellEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { errorText } from "@/lib/errors";
import {
  cellKeyAction,
  editedLabel,
  isConflictMessage,
  isEditableColumn,
  patchRow,
  rawCellValue,
  restoreField,
  validateCell,
} from "@/lib/inlineEdit";
import { fetchCountries, type Country } from "@/lib/countries";
import { ITEM_TYPES, SEEDED_UNITS, countryLabel, isItemType, NEW_CONDITION_NOTES } from "@/lib/itemFields";
import { fetchItemList, fetchListedItem, fetchTaxonomyChoices, saveItemCell } from "@/lib/items";
import { fetchManufacturerChoices } from "@/lib/manufacturers";
import { fetchUnits } from "@/lib/units";
import type { DataType, ItemListColumn, ItemListRow, TaxonomyChoice } from "@/lib/types";

type ActiveCell = { row: number; col: number };
type Editing = { row: number; col: number; seed: string | null };
type CellStatus = { state: "saving" | "saved" | "error"; message?: string; at?: string };
type GridColumn = {
  id: string;
  label: string;
  dataType?: DataType;
  usesList?: boolean;
  allowedValues?: string[];
};

const LEADING = [
  { id: "photo", label: "Photo" },
  { id: "taxonomy", label: "Taxonomy" },
  { id: "sku", label: "SKU" },
  { id: "name", label: "Name" },
  { id: "item_type", label: "Item type" },
  { id: "manufacturer", label: "Manufacturer" },
  { id: "model", label: "Model" },
  { id: "part_number", label: "Part number" },
  { id: "oem_name", label: "OEM name" },
  { id: "oem_part_number", label: "OEM part number" },
  { id: "unit", label: "Unit" },
  { id: "condition", label: "Condition" },
] as const;

const TRADE = [
  { id: "condition_note", label: "Condition note" },
  { id: "eccn", label: "ECCN" },
  { id: "us_hts", label: "US HTS" },
  { id: "ccats", label: "CCATS" },
  { id: "coo", label: "COO" },
] as const;

const PRICES = [
  { id: "ecommerce_price", label: "Ecommerce price" },
  { id: "market_price", label: "Market price" },
  { id: "msrp", label: "MSRP" },
] as const;

function fieldSummary(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([name, value]) => `${name} ${value}`)
    .join(" · ");
}

function columnLabel(column: ItemListColumn): string {
  return column.unit ? `${column.name} (${column.unit})` : column.name;
}

function displayValue(item: ItemListRow, columnId: string, countries: Country[]): string {
  if (columnId === "sku") return item.sku || "—";
  if (columnId === "name") return item.name || "Untitled";
  if (columnId === "item_type") return item.itemType;
  if (columnId === "manufacturer") return item.manufacturerName || "—";
  if (columnId === "model") return item.model || "—";
  if (columnId === "part_number") return item.partNumber || "—";
  if (columnId === "oem_name") return item.oemName || "—";
  if (columnId === "oem_part_number") return item.oemPartNumber || "—";
  if (columnId === "unit") return item.unit || "—";
  if (columnId === "condition") return item.condition || "—";
  if (columnId === "condition_note") return item.conditionNote || "—";
  if (columnId === "eccn") return item.eccn || "—";
  if (columnId === "us_hts") return item.usHts || "—";
  if (columnId === "ccats") return item.ccats || "—";
  if (columnId === "coo") {
    if (!item.coo) return "—";
    const country = countries.find((row) => row.alpha3 === item.coo);
    return country ? country.alpha3 : item.coo;
  }
  if (columnId === "quantity") return item.quantity === null ? "—" : String(item.quantity);
  if (columnId === "edited") return editedLabel(item.updatedAt) || "—";
  if (columnId === "ecommerce_price") return item.ecommercePrice || "—";
  if (columnId === "market_price") return item.marketPrice || "—";
  if (columnId === "msrp") return item.msrp || "—";
  if (columnId === "fields") return fieldSummary(item.fields) || "—";
  if (columnId.startsWith("attr:")) return item.fields[columnId.slice(5)] || "—";
  return "";
}

function editorDisplay(item: ItemListRow, columnId: string, countries: Country[]): string {
  if (columnId === "manufacturer") return item.manufacturerName ?? "";
  if (columnId === "coo") {
    const country = countries.find((row) => row.alpha3 === item.coo);
    return country ? countryLabel(country.alpha3, country.name) : item.coo;
  }
  const raw = rawCellValue(item, columnId);
  return raw;
}

export function ItemsTable() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tax = (params.get("tax") ?? "").trim().toUpperCase();
  const q = params.get("q") ?? "";
  const conditionParam = params.get("condition") ?? "";
  const condition = conditionParam === "New" || conditionParam === "Used" ? conditionParam : "";
  const typeParam = params.get("type") ?? "";
  const itemType = isItemType(typeParam) ? typeParam : "";
  const manufacturerId = params.get("mfr") ?? "";
  const [draft, setDraft] = useState(q);
  const [choices, setChoices] = useState<TaxonomyChoice[]>([]);
  const [manufacturers, setManufacturers] = useState<{ id: string; name: string }[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [units, setUnits] = useState<string[]>([...SEEDED_UNITS]);
  const [rows, setRows] = useState<ItemListRow[]>([]);
  const [columns, setColumns] = useState<ItemListColumn[]>([]);
  const [pricing, setPricing] = useState(false);
  const [total, setTotal] = useState(0);
  const [unknownTax, setUnknownTax] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [cellStatus, setCellStatus] = useState<Record<string, CellStatus>>({});
  const [pendingBulk, setPendingBulk] = useState<{ field: BulkField; value: string; label: string } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const rowsRef = useRef(rows);
  const chains = useRef(new Map<string, Promise<string>>());
  rowsRef.current = rows;

  const gridColumns = useMemo<GridColumn[]>(() => {
    const extra =
      columns.length > 0
        ? columns.map((column) => ({
            id: `attr:${column.name}`,
            label: columnLabel(column),
            dataType: column.dataType,
            usesList: column.usesList,
            allowedValues: column.allowedValues,
          }))
        : [{ id: "fields", label: "Fields" }];
    return [
      ...LEADING,
      ...TRADE,
      ...(pricing ? PRICES : []),
      { id: "quantity", label: "Quantity" },
      { id: "edited", label: "Edited" },
      ...extra,
    ];
  }, [columns, pricing]);

  useEffect(() => {
    setDraft(q);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTaxonomyChoices(), fetchManufacturerChoices(), fetchCountries(), fetchUnits()])
      .then(([nextChoices, nextMakers, nextCountries, nextUnits]) => {
        if (cancelled) return;
        setChoices(nextChoices);
        setManufacturers(nextMakers);
        setCountries(nextCountries);
        setUnits(nextUnits);
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
    fetchItemList({ tax, q, condition, manufacturerId, itemType })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setColumns(result.columns);
        setPricing(result.pricing);
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
  }, [tax, q, condition, manufacturerId, itemType]);

  useEffect(() => {
    if (!active || editing) return;
    const cell = cellRefs.current.get(`${active.row}:${active.col}`);
    if (!cell) return;
    if (document.activeElement !== cell) cell.focus();
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, rows, gridColumns, editing]);

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
    setActive({
      row: Math.max(0, Math.min(rows.length - 1, row)),
      col: Math.max(0, Math.min(gridColumns.length - 1, col)),
    });
  }

  function beginEdit(row: number, col: number, seed: string | null) {
    const column = gridColumns[col];
    if (!column || !isEditableColumn(column.id)) return;
    setActive({ row, col });
    setEditing({ row, col, seed });
  }

  function markCell(id: string, columnId: string, status: CellStatus) {
    setCellStatus((current) => ({ ...current, [`${id}:${columnId}`]: status }));
  }

  function enqueue(item: ItemListRow, columnId: string, wire: string, original: ItemListRow) {
    const prev = chains.current.get(item.id) ?? Promise.resolve(item.updatedAt);
    const next = prev.then(async (expected) => {
      markCell(item.id, columnId, { state: "saving" });
      try {
        const saved = await saveItemCell({
          id: item.id,
          field: columnId,
          value: wire,
          expectedUpdatedAt: expected,
        });
        setRows((current) =>
          current.map((row) => {
            if (row.id !== item.id) return row;
            let patched = patchRow(row, columnId, saved.value);
            if (columnId === "manufacturer") {
              patched = {
                ...patched,
                manufacturerId: saved.manufacturerId,
                manufacturerName: saved.manufacturerName,
              };
            }
            if (columnId === "condition" || columnId === "condition_note") {
              patched = { ...patched, conditionNote: saved.conditionNote };
            }
            return { ...patched, updatedAt: saved.updatedAt };
          }),
        );
        markCell(item.id, columnId, { state: "saved", at: saved.updatedAt });
        setError(null);
        return saved.updatedAt;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Save failed.";
        if (isConflictMessage(message)) {
          const fresh = await fetchListedItem(item.id).catch(() => null);
          if (fresh) {
            setRows((current) => current.map((row) => (row.id === item.id ? fresh : row)));
          }
          setError("This row was edited somewhere else. It was reloaded.");
          markCell(item.id, columnId, { state: "error", message: "Reload" });
          return fresh?.updatedAt || expected;
        }
        setRows((current) =>
          current.map((row) => (row.id === item.id ? restoreField(row, original, columnId) : row)),
        );
        setError(message);
        markCell(item.id, columnId, { state: "error", message });
        return expected;
      }
    });
    chains.current.set(item.id, next);
  }

  function commitEdit(rowIndex: number, column: GridColumn, wire: string, moveDir: "down" | "right" | "left" | null) {
    const item = rowsRef.current[rowIndex];
    if (!item) return;
    const checked = validateCell({
      columnId: column.id,
      value: wire,
      condition: item.condition,
      conditionNote: item.conditionNote,
      dataType: column.dataType,
      units,
    });
    setEditing(null);
    if (checked.error) {
      setError(checked.error);
      markCell(item.id, column.id, { state: "error", message: checked.error });
      return;
    }
    const original = item;
    setRows((current) =>
      current.map((row) => {
        if (row.id !== item.id) return row;
        if (column.id === "manufacturer") return { ...row, manufacturerId: checked.value || null };
        return patchRow(row, column.id, checked.value);
      }),
    );
    markCell(item.id, column.id, { state: "saving" });
    enqueue(item, column.id, checked.value, original);
    if (moveDir === "down") move(rowIndex + 1, gridColumns.findIndex((entry) => entry.id === column.id));
    if (moveDir === "right") move(rowIndex, gridColumns.findIndex((entry) => entry.id === column.id) + 1);
    if (moveDir === "left") move(rowIndex, gridColumns.findIndex((entry) => entry.id === column.id) - 1);
  }

  function onGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    if (editing) return;
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
    const column = gridColumns[col];
    const action = active
      ? cellKeyAction({
          key: event.key,
          editable: column ? isEditableColumn(column.id) : false,
          meta: event.metaKey,
          ctrl: event.ctrlKey,
          alt: event.altKey,
        })
      : null;

    if (action === "edit") beginEdit(row, col, null);
    else if (action === "type") beginEdit(row, col, event.key);
    else if (action === "open" && active) router.push(`/items/${rows[active.row].id}`);
    else if (event.key === "ArrowDown") move(active ? row + 1 : 0, col);
    else if (event.key === "ArrowUp") move(active ? row - 1 : rows.length - 1, col);
    else if (event.key === "ArrowRight") move(active ? row : 0, active ? col + 1 : 0);
    else if (event.key === "ArrowLeft") move(active ? row : 0, active ? col - 1 : gridColumns.length - 1);
    else if (event.key === "Home") move(active ? row : 0, 0);
    else if (event.key === "End") move(active ? row : 0, gridColumns.length - 1);
    else if (event.key === "PageDown") move((active ? row : 0) + pageSize, col);
    else if (event.key === "PageUp") move((active ? row : 0) - pageSize, col);
    else return;
    event.preventDefault();
  }

  function toggleRow(id: string, index: number, shift: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (shift && anchor !== null) {
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        for (let cursor = start; cursor <= end; cursor += 1) {
          const row = rows[cursor];
          if (row) next.add(row.id);
        }
        return next;
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchor(index);
  }

  async function applyBulk() {
    if (!pendingBulk) return;
    setBulkBusy(true);
    const ids = rows.filter((row) => selected.has(row.id)).map((row) => row.id);
    const column = gridColumns.find((entry) => entry.id === pendingBulk.field);
    for (const id of ids) {
      const index = rowsRef.current.findIndex((row) => row.id === id);
      const item = rowsRef.current[index];
      if (!item || !column) continue;
      commitEdit(index, column, pendingBulk.value, null);
    }
    setBulkBusy(false);
    setPendingBulk(null);
    setSelected(new Set());
  }

  const knownTax = choices.some((choice) => choice.shortCode === tax);
  const visibleIds = rows.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

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
          aria-label="Filter by item type"
          value={itemType}
          onChange={(event) => setParam("type", event.target.value)}
        >
          <option value="">All item types</option>
          {ITEM_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
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
        <ItemExportMenu tax={tax} q={q} condition={condition} manufacturerId={manufacturerId} itemType={itemType} />
        <Link className="button" href="/items/new">
          New item
        </Link>
      </div>
      <p id="items-help" className="hint items-help">
        Arrow keys move the cell. Enter or typing edits it. Enter and Tab save and move, Esc cancels.
        Enter on the SKU or name opens the item. / focuses search.
      </p>
      {selected.size > 0 ? (
        <BulkEditBar
          count={selected.size}
          countries={countries}
          onApply={(field, value, label) => setPendingBulk({ field, value, label })}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
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
                <th
                  key={column.id}
                  role="columnheader"
                  aria-colindex={index + 1}
                  scope="col"
                  title={column.id === "coo" ? "Country of origin" : undefined}
                >
                  {column.id === "photo" ? (
                    <>
                    <span className="sr-only">Photo</span>
                    <input
                      className="row-select"
                      type="checkbox"
                      aria-label="Select all visible items"
                      checked={allVisibleSelected}
                      onChange={() => {
                        setSelected((current) => {
                          const next = new Set(current);
                          if (allVisibleSelected) {
                            for (const id of visibleIds) next.delete(id);
                          } else {
                            for (const id of visibleIds) next.add(id);
                          }
                          return next;
                        });
                      }}
                    />
                    </>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((item, rowIndex) => {
              const rowSelected = active?.row === rowIndex;
              return (
                <tr key={item.id} role="row" aria-rowindex={rowIndex + 2} aria-selected={rowSelected}>
                  {gridColumns.map((column, colIndex) => {
                    const selectedCell = rowSelected && active?.col === colIndex;
                    const editingCell = editing?.row === rowIndex && editing.col === colIndex;
                    const status = cellStatus[`${item.id}:${column.id}`] ?? null;
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
                        aria-selected={selectedCell}
                        tabIndex={selectedCell && !editingCell ? 0 : -1}
                        className={[
                          column.id === "name" ||
                          column.id === "fields" ||
                          column.id === "manufacturer" ||
                          column.id === "model" ||
                          column.id === "part_number" ||
                          column.id === "oem_name" ||
                          column.id === "oem_part_number" ||
                          column.id === "condition_note"
                            ? "clip"
                            : "",
                          column.id === "edited" ? "edited-time" : "",
                          status ? "has-flag" : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined}
                        onClick={() => setActive({ row: rowIndex, col: colIndex })}
                        onDoubleClick={() => {
                          if (isEditableColumn(column.id)) beginEdit(rowIndex, colIndex, null);
                          else router.push(`/items/${item.id}`);
                        }}
                      >
                        {column.id === "photo" ? (
                          <span className="photo-cell">
                            <input
                              type="checkbox"
                              className="row-select"
                              aria-label={`Select ${item.sku || "item"}`}
                              checked={selected.has(item.id)}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleRow(item.id, rowIndex, event.shiftKey);
                              }}
                              onChange={() => undefined}
                            />
                            {item.imageUrl ? (
                              <img className="thumb-sm" src={item.imageUrl} alt="" />
                            ) : (
                              <span className="thumb-empty" aria-hidden>
                                —
                              </span>
                            )}
                          </span>
                        ) : editing && editingCell ? (
                          <CellEditor
                            mode={
                              column.id === "condition" ||
                              column.id === "item_type" ||
                              column.id === "unit" ||
                              (column.id === "condition_note" && item.condition === "New")
                                ? "select"
                                : column.id === "manufacturer"
                                  ? "manufacturer"
                                  : column.id === "coo"
                                    ? "country"
                                    : "text"
                            }
                            value={
                              column.id === "condition_note" && item.condition === "New"
                                ? NEW_CONDITION_NOTES.includes(item.conditionNote as (typeof NEW_CONDITION_NOTES)[number])
                                  ? item.conditionNote
                                  : ""
                                : rawCellValue(item, column.id)
                            }
                            display={editorDisplay(item, column.id, countries)}
                            seed={editing.seed}
                            options={
                              column.id === "unit"
                                ? [...new Set([...(units.length > 0 ? units : [...SEEDED_UNITS]), item.unit || "Piece"])].map((name) => ({
                                    value: name,
                                    label: name,
                                  }))
                                : column.id === "item_type"
                                ? ITEM_TYPES.map((type) => ({ value: type, label: type }))
                                : column.id === "condition"
                                  ? [
                                      { value: "Used", label: "Used" },
                                      { value: "New", label: "New" },
                                    ]
                                  : [
                                      { value: "", label: "None" },
                                      ...NEW_CONDITION_NOTES.map((note) => ({ value: note, label: note })),
                                    ]
                            }
                            countries={countries}
                            allowedValues={column.usesList ? column.allowedValues : undefined}
                            inputMode={
                              column.id === "ecommerce_price" || column.id === "market_price" || column.id === "msrp" || column.dataType === "decimal"
                                ? "decimal"
                                : column.dataType === "integer"
                                  ? "numeric"
                                  : undefined
                            }
                            onCommit={(value, moveDir) => commitEdit(rowIndex, column, value, moveDir)}
                            onCancel={() => setEditing(null)}
                            onInvalid={(message) => {
                              setError(message);
                              markCell(item.id, column.id, { state: "error", message });
                            }}
                          />
                        ) : column.id === "taxonomy" ? (
                          item.shortCode ? <span className="code-badge">{item.shortCode}</span> : "—"
                        ) : (
                          displayValue(item, column.id, countries)
                        )}
                        {status ? (
                          <span
                            className={status.state === "error" ? "cell-flag error" : "cell-flag"}
                            title={status.message}
                          >
                            {status.state === "saving" ? "Saving" : status.state === "saved" ? "Saved" : "Error"}
                          </span>
                        ) : null}
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
      {pendingBulk ? (
        <ConfirmDialog
          title="Update selected items"
          body={`Set ${pendingBulk.field === "coo" ? "COO" : pendingBulk.field === "eccn" ? "ECCN" : pendingBulk.field === "item_type" ? "Item type" : "Condition"} to ${pendingBulk.label} on ${selected.size} ${selected.size === 1 ? "item" : "items"}?`}
          confirmLabel="Update"
          busy={bulkBusy}
          onCancel={() => {
            if (!bulkBusy) setPendingBulk(null);
          }}
          onConfirm={() => {
            void applyBulk();
          }}
        />
      ) : null}
    </main>
  );
}
