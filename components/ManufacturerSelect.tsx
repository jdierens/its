"use client";

import { useEffect, useId, useRef, useState } from "react";
import { errorText } from "@/lib/errors";
import { normalizeLabel } from "@/lib/itemFields";
import {
  createManufacturer,
  suggestManufacturers,
  type ManufacturerSuggestion,
} from "@/lib/manufacturers";

export function ManufacturerSelect({
  manufacturerId,
  manufacturerName,
  onChange,
  onUnresolved,
}: {
  manufacturerId: string | null;
  manufacturerName: string;
  onChange: (id: string | null, name: string) => void;
  onUnresolved: (unresolved: boolean) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState(manufacturerName);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<ManufacturerSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const focused = useRef(false);

  const unresolved =
    query.trim().length > 0 && normalizeLabel(query) !== normalizeLabel(manufacturerName);

  useEffect(() => {
    onUnresolved(unresolved);
  }, [onUnresolved, unresolved]);

  useEffect(() => {
    if (focused.current) return;
    setQuery(manufacturerName);
  }, [manufacturerName]);

  useEffect(() => {
    if (!open) return;
    const current = ++request.current;
    const handle = window.setTimeout(() => {
      suggestManufacturers(query)
        .then((rows) => {
          if (current === request.current) setSuggestions(rows);
        })
        .catch((err: unknown) => {
          if (current === request.current) setError(errorText(err));
        });
    }, 180);
    return () => {
      window.clearTimeout(handle);
      request.current += 1;
    };
  }, [open, query]);

  const exact = suggestions.some((row) => row.score >= 0.99);
  const showAdd = query.trim().length > 0 && !exact;

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const created = await createManufacturer(query);
      onChange(created.id, created.name);
      setQuery(created.name);
      setOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="combo">
      Manufacturer
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        placeholder="Search or add a manufacturer"
        autoComplete="off"
        onFocus={() => {
          focused.current = true;
          setOpen(true);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
          if (next.trim() === "") onChange(null, "");
        }}
        onBlur={() => {
          focused.current = false;
          window.setTimeout(() => setOpen(false), 160);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setQuery(manufacturerName);
          }
        }}
      />
      {open ? (
        <ul className="combo-menu" id={listId} role="listbox">
          {suggestions.map((row) => {
            const alias = normalizeLabel(row.matched) !== normalizeLabel(row.name);
            const similar = row.score < 0.99;
            return (
              <li key={`${row.id}-${row.matched}`}>
                <button
                  type="button"
                  className="combo-option"
                  role="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(row.id, row.name);
                    setQuery(row.name);
                    setOpen(false);
                  }}
                >
                  {alias ? `${row.name} — alias ${row.matched}` : similar ? `${row.name} — similar` : row.name}
                </button>
              </li>
            );
          })}
          {suggestions.length === 0 ? <li className="combo-empty">No close matches.</li> : null}
          {showAdd ? (
            <li>
              <button
                type="button"
                className="combo-option add"
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void add()}
              >
                {busy ? "Adding…" : `Add manufacturer “${query.trim()}”`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {manufacturerId ? (
        <button
          type="button"
          className="secondary combo-clear"
          onClick={() => {
            onChange(null, "");
            setQuery("");
          }}
        >
          Clear manufacturer
        </button>
      ) : null}
      {error ? <span className="hint">{error}</span> : null}
    </label>
  );
}
