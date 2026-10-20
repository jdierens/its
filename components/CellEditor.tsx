"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { errorText } from "@/lib/errors";
import { countryLabel, normalizeLabel } from "@/lib/itemFields";
import { createManufacturer, suggestManufacturers, type ManufacturerSuggestion } from "@/lib/manufacturers";
import type { Country } from "@/lib/countries";

type Move = "down" | "right" | "left" | null;

export function CellEditor({
  mode,
  value,
  display,
  seed,
  options,
  countries,
  allowedValues,
  inputMode,
  prefix,
  onCommit,
  onCancel,
  onInvalid,
}: {
  mode: "text" | "select" | "manufacturer" | "country";
  value: string;
  display: string;
  seed: string | null;
  options?: { value: string; label: string }[];
  countries?: Country[];
  allowedValues?: string[];
  inputMode?: "decimal" | "numeric";
  prefix?: string;
  onCommit: (value: string, move: Move) => void;
  onCancel: () => void;
  onInvalid: (message: string) => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const done = useRef(false);
  const invalidRef = useRef(onInvalid);
  invalidRef.current = onInvalid;
  const [text, setText] = useState(
    seed ?? (mode === "manufacturer" || mode === "country" || prefix ? display : value),
  );
  const [open, setOpen] = useState(mode === "manufacturer" || mode === "country");
  const [suggestions, setSuggestions] = useState<ManufacturerSuggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    if (node instanceof HTMLInputElement && seed == null) node.select();
  }, [seed]);

  useEffect(() => {
    if (mode !== "manufacturer" || !open) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      suggestManufacturers(text)
        .then((rows) => {
          if (!cancelled) {
            setSuggestions(rows);
            setHighlight(0);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) invalidRef.current(errorText(err));
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [mode, open, text]);

  useEffect(() => {
    if (!open || (mode !== "manufacturer" && mode !== "country")) return;
    function place() {
      const node = inputRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setMenuBox({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 220) });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, mode, text, suggestions.length]);

  function finish(next: string, move: Move) {
    if (done.current) return;
    done.current = true;
    onCommit(next, move);
  }

  function cancel() {
    if (done.current) return;
    done.current = true;
    onCancel();
  }

  function onTextKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (mode === "manufacturer") {
        void pickManufacturer("down");
        return;
      }
      if (mode === "country") {
        pickCountry("down");
        return;
      }
      finish(text, "down");
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (mode === "manufacturer") {
        void pickManufacturer(event.shiftKey ? "left" : "right");
        return;
      }
      if (mode === "country") {
        pickCountry(event.shiftKey ? "left" : "right");
        return;
      }
      finish(text, event.shiftKey ? "left" : "right");
      return;
    }
    if (mode === "manufacturer" && open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setHighlight((current) => {
        const last = Math.max(suggestions.length - 1, 0);
        return event.key === "ArrowDown" ? Math.min(last, current + 1) : Math.max(0, current - 1);
      });
    }
  }

  async function pickManufacturer(move: Move) {
    if (!text.trim()) {
      finish("", move);
      return;
    }
    const exact = suggestions.find((row) => row.score >= 0.99);
    const choice = suggestions[highlight] && suggestions[highlight].score >= 0.99 ? suggestions[highlight] : exact;
    if (choice) {
      finish(choice.id, move);
      return;
    }
    invalidRef.current("Choose a manufacturer from the list, or add the new name.");
    inputRef.current?.focus();
  }

  function pickCountry(move: Move) {
    const needle = normalizeLabel(text);
    if (!needle) {
      finish("", move);
      return;
    }
    const match = (countries ?? []).find((country) => {
      const label = normalizeLabel(`${country.alpha3} ${country.name}`);
      return label === needle || normalizeLabel(country.alpha3) === needle;
    });
    if (!match) {
      invalidRef.current("Country of origin must be an ISO alpha-3 code.");
      inputRef.current?.focus();
      return;
    }
    finish(match.alpha3, move);
  }

  const countryMatches = (countries ?? [])
    .filter((country) => {
      const needle = normalizeLabel(text);
      if (!needle) return true;
      return normalizeLabel(`${country.alpha3} ${country.alpha2} ${country.name}`).includes(needle);
    })
    .slice(0, 8);

  if (mode === "select") {
    return (
      <select
        ref={inputRef as RefObject<HTMLSelectElement>}
        className="cell-input"
        aria-label="Edit cell"
        value={value}
        onChange={(event) => finish(event.target.value, null)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          } else if (event.key === "Enter") {
            event.preventDefault();
            finish((event.target as HTMLSelectElement).value, "down");
          } else if (event.key === "Tab") {
            event.preventDefault();
            finish((event.target as HTMLSelectElement).value, event.shiftKey ? "left" : "right");
          }
        }}
        onBlur={() => finish(value, null)}
      >
        {(options ?? []).map((option) => (
          <option key={option.value || "empty"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <span className="cell-combo">
      {prefix ? (
        <span className="money-prefix" aria-hidden="true">
          {prefix}
        </span>
      ) : null}
      <input
        ref={inputRef as RefObject<HTMLInputElement>}
        className="cell-input"
        aria-label="Edit cell"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        value={text}
        inputMode={inputMode}
        list={allowedValues && allowedValues.length > 0 ? listId : undefined}
        autoComplete="off"
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onTextKey}
        onBlur={() => {
          window.setTimeout(() => {
            if (done.current) return;
            if (mode === "manufacturer") {
              void pickManufacturer(null);
              return;
            }
            if (mode === "country") {
              pickCountry(null);
              return;
            }
            finish(text, null);
          }, 160);
        }}
      />
      {allowedValues && allowedValues.length > 0 ? (
        <datalist id={listId}>
          {allowedValues.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
      {mode === "manufacturer" && open && menuBox ? (
        <ul
          className="combo-menu cell-menu"
          id={listId}
          role="listbox"
          style={{ top: menuBox.top, left: menuBox.left, width: menuBox.width }}
        >
          {suggestions.map((row, index) => (
            <li key={`${row.id}-${row.matched}`}>
              <button
                type="button"
                className="combo-option"
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => finish(row.id, null)}
              >
                {row.name}
                {normalizeLabel(row.matched) !== normalizeLabel(row.name) ? ` · ${row.matched}` : ""}
              </button>
            </li>
          ))}
          {text.trim() && !suggestions.some((row) => row.score >= 0.99) ? (
            <li>
              <button
                type="button"
                className="combo-option add"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  createManufacturer(text)
                    .then((created) => finish(created.id, null))
                    .catch((err: unknown) => invalidRef.current(errorText(err)));
                }}
              >
                Add {text.trim()}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {mode === "country" && open && menuBox ? (
        <ul
          className="combo-menu cell-menu"
          id={listId}
          role="listbox"
          style={{ top: menuBox.top, left: menuBox.left, width: menuBox.width }}
        >
          <li>
            <button
              type="button"
              className="combo-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => finish("", null)}
            >
              No country
            </button>
          </li>
          {countryMatches.map((country) => (
            <li key={country.alpha3}>
              <button
                type="button"
                className="combo-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => finish(country.alpha3, null)}
              >
                {countryLabel(country.alpha3, country.name)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
