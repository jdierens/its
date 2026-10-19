"use client";

import { useId, useMemo, useState } from "react";
import type { Country } from "@/lib/countries";
import { countryLabel, normalizeLabel } from "@/lib/itemFields";

export function CountrySelect({
  countries,
  value,
  onChange,
}: {
  countries: Country[];
  value: string;
  onChange: (alpha3: string) => void;
}) {
  const listId = useId();
  const selected = countries.find((country) => country.alpha3 === value) ?? null;
  const [query, setQuery] = useState(selected ? countryLabel(selected.alpha3, selected.name) : "");
  const [open, setOpen] = useState(false);

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

  return (
    <label className="combo" title="Country of origin">
      COO
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        title="Country of origin"
        value={open ? query : selected ? countryLabel(selected.alpha3, selected.name) : ""}
        placeholder="Search countries"
        autoComplete="off"
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (event.target.value.trim() === "") onChange("");
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
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
                onChange("");
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
                  onChange(country.alpha3);
                  setQuery(countryLabel(country.alpha3, country.name));
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
      <span className="hint">ISO alpha-3. Leave this empty until the origin is known.</span>
    </label>
  );
}
