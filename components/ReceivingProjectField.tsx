"use client";

import { KeyboardEvent, useEffect, useId, useState } from "react";
import { filterRecentProjects } from "@/lib/receivingProjects";

function ReceivingValueList({
  id,
  label,
  listLabel,
  clearLabel,
  emptyHint,
  noMatchHint,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  listLabel: string;
  clearLabel: string;
  emptyHint: string;
  noMatchHint: string;
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [active, setActive] = useState(-1);
  const shown = narrow ? filterRecentProjects(options, value) : options;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    setActive((current) => (current >= shown.length ? -1 : current));
  }, [shown.length]);

  function choose(name: string) {
    onChange(name);
    setNarrow(false);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (shown.length === 0 ? -1 : (current + 1) % shown.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (shown.length === 0 ? -1 : (current <= 0 ? shown.length - 1 : current - 1)));
      return;
    }
    if (event.key === "Enter" && open && active >= 0 && shown[active]) {
      event.preventDefault();
      choose(shown[active]);
    }
  }

  return (
    <label className="receive-project" htmlFor={id}>
      <span>{label}</span>
      <span className="receive-project-control">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-opt-${active}` : undefined}
          value={value}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          disabled={disabled}
          onFocus={() => {
            setNarrow(false);
            setActive(-1);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setNarrow(true);
            setActive(-1);
            setOpen(true);
            onChange(event.target.value);
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 250);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="secondary receive-project-clear"
          aria-label={clearLabel}
          disabled={disabled || value.length === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange("");
            setNarrow(false);
            setOpen(true);
            document.getElementById(id)?.focus();
          }}
        >
          Clear
        </button>
      </span>
      {open ? (
        <ul className="receive-project-menu" id={listId} role="listbox" aria-label={listLabel}>
          {shown.map((name, index) => (
            <li key={name}>
              <button
                type="button"
                id={`${listId}-opt-${index}`}
                className="receive-project-option"
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(name)}
              >
                {name}
              </button>
            </li>
          ))}
          {shown.length === 0 ? (
            <li className="receive-project-empty">{options.length === 0 ? emptyHint : noMatchHint}</li>
          ) : null}
        </ul>
      ) : null}
    </label>
  );
}

export function ReceivingProjectField({
  value,
  projects,
  disabled,
  onChange,
}: {
  value: string;
  projects: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <ReceivingValueList
      id="receive-project"
      label="Project"
      listLabel="Recent projects"
      clearLabel="Clear project"
      emptyHint="No recent projects yet. Type a name to start one."
      noMatchHint="No recent project matches. The name you type is used."
      value={value}
      options={projects}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export function ReceivingOriginField({
  value,
  origins,
  disabled,
  onChange,
}: {
  value: string;
  origins: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <ReceivingValueList
      id="receive-origin"
      label="Originating system"
      listLabel="Originating systems"
      clearLabel="Clear originating system"
      emptyHint="No originating systems yet. Type a name to add one."
      noMatchHint="No matching system. The name you type is used."
      value={value}
      options={origins}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
