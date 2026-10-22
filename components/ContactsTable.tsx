"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { QueryField } from "@/components/QueryField";
import { errorText } from "@/lib/errors";
import { fetchContactList, type Contact } from "@/lib/contacts";
import type { ContactKind, SyncStatus } from "@/lib/qbo/map";

type ActiveCell = { row: number; col: number };

const COLUMNS = [
  { id: "name", label: "Display name" },
  { id: "company", label: "Company" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "active", label: "Active" },
  { id: "sync", label: "Sync" },
] as const;

const SYNC_LABEL: Record<SyncStatus, string> = {
  local: "Local",
  pending: "Pending",
  synced: "Synced",
  error: "Error",
  conflict: "Conflict",
};

export function ContactsTable({ kind }: { kind: ContactKind }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const noun = kind === "customer" ? "customers" : "vendors";
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [rows, setRows] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveCell | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());

  const commitSearch = useCallback((trimmed: string) => {
    if (trimmed === (paramsRef.current.get("q") ?? "")) return;
    const next = new URLSearchParams(paramsRef.current.toString());
    if (trimmed) next.set("q", trimmed);
    else next.delete("q");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchContactList(kind, q)
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTotal(result.total);
        setError(null);
        setActive((current) => {
          if (!current || current.row >= result.rows.length) return null;
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
  }, [kind, q]);

  useEffect(() => {
    if (!active) return;
    const cell = cellRefs.current.get(`${active.row}:${active.col}`);
    if (!cell) return;
    if (document.activeElement !== cell) cell.focus();
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, rows]);

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

  function move(row: number, col: number) {
    if (rows.length === 0) return;
    setActive({
      row: Math.max(0, Math.min(rows.length - 1, row)),
      col: Math.max(0, Math.min(COLUMNS.length - 1, col)),
    });
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
    else if (event.key === "ArrowLeft") move(active ? row : 0, active ? col - 1 : COLUMNS.length - 1);
    else if (event.key === "Home") move(active ? row : 0, 0);
    else if (event.key === "End") move(active ? row : 0, COLUMNS.length - 1);
    else if (event.key === "PageDown") move((active ? row : 0) + pageSize, col);
    else if (event.key === "PageUp") move((active ? row : 0) - pageSize, col);
    else if (event.key === "Enter" && active) router.push(`/${noun}/${rows[active.row].id}`);
    else return;
    event.preventDefault();
  }

  function cellText(contact: Contact, columnId: string): string {
    if (columnId === "name") return contact.displayName;
    if (columnId === "company") return contact.companyName || "—";
    if (columnId === "email") return contact.primaryEmail || "—";
    if (columnId === "phone") return contact.phone || "—";
    if (columnId === "active") return contact.active ? "Yes" : "No";
    return SYNC_LABEL[contact.syncStatus];
  }

  return (
    <main className="page items-page">
      <div className="items-toolbar">
        <QueryField
          inputRef={searchRef}
          className="items-search"
          type="search"
          aria-label={`Search ${noun}`}
          placeholder="Search name, company, email, phone"
          value={q}
          onCommit={commitSearch}
        />
        <p className="items-count">
          {loading && rows.length === 0
            ? `Loading ${noun}…`
            : `${rows.length} of ${total} ${noun}`}
        </p>
        <Link className="button" href={`/${noun}/new`}>
          {kind === "customer" ? "New customer" : "New vendor"}
        </Link>
      </div>
      <p id="contacts-help" className="hint items-help">
        Arrow keys move the cell, Enter opens the {kind}, and / focuses search.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      <div
        ref={scrollRef}
        className="items-scroll"
        tabIndex={active ? -1 : 0}
        onKeyDown={onGridKeyDown}
      >
        <table
          className="items-grid contacts-grid"
          role="grid"
          aria-label={kind === "customer" ? "Customers" : "Vendors"}
          aria-describedby="contacts-help"
          aria-rowcount={rows.length + 1}
          aria-colcount={COLUMNS.length}
          aria-busy={loading}
        >
          <thead>
            <tr role="row" aria-rowindex={1}>
              {COLUMNS.map((column, index) => (
                <th key={column.id} role="columnheader" aria-colindex={index + 1} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((contact, rowIndex) => {
              const rowSelected = active?.row === rowIndex;
              return (
                <tr
                  key={contact.id}
                  role="row"
                  aria-rowindex={rowIndex + 2}
                  aria-selected={rowSelected}
                  className={contact.active ? undefined : "is-inactive"}
                >
                  {COLUMNS.map((column, colIndex) => {
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
                        className={column.id === "name" || column.id === "company" || column.id === "email" ? "clip" : undefined}
                        onClick={() => setActive({ row: rowIndex, col: colIndex })}
                        onDoubleClick={() => router.push(`/${noun}/${contact.id}`)}
                      >
                        {column.id === "sync" ? (
                          <span className={`sync-pill ${contact.syncStatus}`}>
                            {SYNC_LABEL[contact.syncStatus]}
                          </span>
                        ) : (
                          cellText(contact, column.id)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 ? <p className="items-empty">No {noun} match.</p> : null}
      </div>
    </main>
  );
}
