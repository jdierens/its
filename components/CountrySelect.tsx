"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Country } from "@/lib/countries";
import { countryLabel, normalizeLabel, resolveCountry, type CountryResolution } from "@/lib/itemFields";

export function CountrySelect({
  countries,
  value,
  onChange,
  bare = false,
  display = "label",
  ariaLabel,
  inputClassName,
  onEnter,
  registerCommit,
}: {
  countries: Country[];
  value: string;
  onChange: (alpha3: string) => void;
  /** Table cell: no field label and no hint. The item page keeps both. */
  bare?: boolean;
  /** Closed field. The item page shows the code and the name. A pick row shows the alpha-3 code. */
  display?: "label" | "code";
  ariaLabel?: string;
  inputClassName?: string;
  onEnter?: () => void;
  /** Latest typed text, so Add can resolve "India" before React re-renders. */
  registerCommit?: (commit: () => CountryResolution) => void;
}) {
  const listId = useId();
  const selected = countries.find((country) => country.alpha3 === value) ?? null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const typed = useRef(false);
  const registerRef = useRef(registerCommit);
  registerRef.current = registerCommit;
  const shown = selected ? (display === "code" ? selected.alpha3 : countryLabel(selected.alpha3, selected.name)) : "";

  const matches = useMemo(() => {
    const needle = normalizeLabel(query);
    const pool = needle
      ? countries.filter((country) => {
          const label = normalizeLabel(`${country.alpha3} ${country.alpha2} ${country.name}`);
          return label.includes(needle);
        })
      : countries;
    return pool.slice(0, 12);
  }, [countries, query]);

  function applyResolved(next: string) {
    if (next !== value) onChange(next);
  }

  function acceptQuery() {
    if (!typed.current) return;
    const resolved = resolveCountry(query, countries);
    if (resolved.status === "match") applyResolved(resolved.alpha3);
    else if (resolved.status === "empty") applyResolved("");
  }

  useEffect(() => {
    registerRef.current?.(() => resolveCountry(open && typed.current ? query : value, countries));
  }, [open, query, value, countries]);

  const field = (
    <>
      <input
        className={inputClassName}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel ?? "Country of origin"}
        title={selected ? countryLabel(selected.alpha3, selected.name) : "Country of origin"}
        value={open ? query : shown}
        placeholder="Search countries"
        autoComplete="off"
        onFocus={() => {
          typed.current = false;
          setQuery("");
          setOpen(true);
        }}
        onChange={(event) => {
          const next = event.target.value;
          typed.current = true;
          setQuery(next);
          setOpen(true);
          const resolved = resolveCountry(next, countries);
          if (resolved.status === "empty") applyResolved("");
          else if (resolved.status === "match") applyResolved(resolved.alpha3);
        }}
        onBlur={() => {
          acceptQuery();
          window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            typed.current = false;
            setOpen(false);
            return;
          }
          if (event.key === "Enter" && onEnter) {
            event.preventDefault();
            acceptQuery();
            setOpen(false);
            onEnter();
          }
        }}
      />
      {open ? (
        <ul className="combo-menu" id={listId} role="listbox">
          <li>
            <button
              type="button"
              className="combo-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                typed.current = false;
                applyResolved("");
                setQuery("");
                setOpen(false);
              }}
            >
              No country
            </button>
          </li>
          {matches.map((country) => (
            <li key={country.alpha3}>
              <button
                type="button"
                className="combo-option"
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  typed.current = false;
                  applyResolved(country.alpha3);
                  setQuery("");
                  setOpen(false);
                }}
              >
                {countryLabel(country.alpha3, country.name)}
              </button>
            </li>
          ))}
          {matches.length === 0 ? <li className="combo-empty">No countries match.</li> : null}
        </ul>
      ) : null}
    </>
  );

  if (bare) {
    return (
      <div className="combo" title="Country of origin">
        {field}
      </div>
    );
  }

  return (
    <label className="combo" title="Country of origin">
      COO
      {field}
      <span className="hint">ISO alpha-3. Leave this empty until the origin is known.</span>
    </label>
  );
}
