"use client";

import { KeyboardEvent, useEffect, useId, useState } from "react";
import { filterRecentProjects } from "@/lib/receivingProjects";

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
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [active, setActive] = useState(-1);
  const shown = narrow ? filterRecentProjects(projects, value) : projects;

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
    <label className="receive-project" htmlFor="receive-project">
      <span>Project</span>
      <span className="receive-project-control">
        <input
          id="receive-project"
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
          aria-label="Clear project"
          disabled={disabled || value.length === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange("");
            setNarrow(false);
            setOpen(true);
            document.getElementById("receive-project")?.focus();
          }}
        >
          Clear
        </button>
      </span>
      {open ? (
        <ul className="receive-project-menu" id={listId} role="listbox" aria-label="Recent projects">
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
            <li className="receive-project-empty">
              {projects.length === 0
                ? "No recent projects yet. Type a name to start one."
                : "No recent project matches. The name you type is used."}
            </li>
          ) : null}
        </ul>
      ) : null}
    </label>
  );
}
