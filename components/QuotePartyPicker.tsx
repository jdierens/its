"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { QuoteFitInput } from "@/components/QuoteFitInput";
import { filterQuoteParties } from "@/lib/quoteReviews";

export type QuotePartyGroup = {
  label: string;
  options: { value: string; name: string }[];
};

export function QuotePartyPicker({
  label,
  value,
  placeholder,
  disabled,
  groups,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  groups: QuotePartyGroup[];
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const selected = selectedName(groups, value);
  const [query, setQuery] = useState(selected);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const focused = useRef(false);
  const shown =
    query.trim() === ""
      ? []
      : groups
          .map((group) => ({ ...group, options: filterQuoteParties(group.options, query) }))
          .filter((group) => group.options.length > 0);
  const flat = shown.flatMap((group) => group.options);

  useEffect(() => {
    if (focused.current) return;
    setQuery(selected);
  }, [selected]);

  useEffect(() => {
    setActive((current) => (current >= flat.length ? -1 : current));
  }, [flat.length]);

  function choose(next: string) {
    onChange(next);
    const name = selectedName(groups, next);
    setQuery(name);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
      setQuery(selected);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (flat.length === 0 ? -1 : (current + 1) % flat.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (flat.length === 0 ? -1 : current <= 0 ? flat.length - 1 : current - 1));
      return;
    }
    if (event.key === "Enter" && open && active >= 0 && flat[active]) choose(flat[active].value);
  }

  let optionIndex = -1;

  return (
    <span className="qr-party">
      <QuoteFitInput
        floor={16}
        cap={36}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={label}
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => {
          focused.current = true;
          setOpen(true);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
          setActive(-1);
          if (next.trim() === "") onChange("");
        }}
        onBlur={() => {
          focused.current = false;
          window.setTimeout(() => {
            setOpen(false);
            setQuery(selectedName(groups, value));
          }, 160);
        }}
        onKeyDown={onKeyDown}
      />
      {open && !disabled ? (
        <ul className="combo-menu" id={listId} role="listbox">
          {query.trim() === "" ? <li className="combo-empty">Type a name.</li> : null}
          {query.trim() !== "" && flat.length === 0 ? <li className="combo-empty">No matches.</li> : null}
          {shown.map((group) => (
            <li key={group.label}>
              {groups.length > 1 ? <span className="qr-party-group">{group.label}</span> : null}
              <ul>
                {group.options.map((option) => {
                  optionIndex += 1;
                  const index = optionIndex;
                  return (
                    <li key={option.value}>
                      <button
                        type="button"
                        role="option"
                        className="combo-option"
                        aria-selected={option.value === value || index === active}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => choose(option.value)}
                      >
                        {option.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

function selectedName(groups: QuotePartyGroup[], value: string): string {
  for (const group of groups) {
    const found = group.options.find((option) => option.value === value);
    if (found) return found.name;
  }
  return "";
}
