"use client";

import { startTransition, useEffect, useRef, useState, type InputHTMLAttributes, type Ref } from "react";
import { QUERY_COMMIT_MS, adoptExternalQuery } from "@/lib/queryDraft";

type QueryFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue"> & {
  value: string;
  onCommit: (next: string) => void;
  delay?: number;
  inputRef?: Ref<HTMLInputElement>;
};

export function QueryField({
  value,
  onCommit,
  delay = QUERY_COMMIT_MS,
  inputRef,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: QueryFieldProps) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const published = useRef(value.trim());
  const draftRef = useRef(draft);
  const onCommitRef = useRef(onCommit);
  draftRef.current = draft;
  onCommitRef.current = onCommit;

  useEffect(() => {
    const next = adoptExternalQuery({
      focused: focused.current,
      draft: draftRef.current,
      external: value,
      published: published.current,
    });
    if (next === null) return;
    published.current = next.trim();
    setDraft(next);
  }, [value]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const trimmed = draft.trim();
      if (trimmed === published.current) return;
      published.current = trimmed;
      startTransition(() => onCommitRef.current(trimmed));
    }, delay);
    return () => window.clearTimeout(handle);
  }, [draft, delay]);

  return (
    <input
      {...rest}
      ref={inputRef}
      value={draft}
      onFocus={(event) => {
        focused.current = true;
        onFocus?.(event);
      }}
      onBlur={(event) => {
        focused.current = false;
        onBlur?.(event);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (draft) setDraft("");
          else event.currentTarget.blur();
          return;
        }
        onKeyDown?.(event);
      }}
    />
  );
}
