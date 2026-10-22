"use client";

import {
  memo,
  startTransition,
  useEffect,
  useRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

type DraftProps = {
  value: string;
  onDraft?: (value: string) => void;
  onValue: (value: string) => void;
  transform?: (value: string) => string;
  /** Changes when a parent action must replace the text, even if the field is focused. */
  syncKey?: string | number;
};

type FieldNode = HTMLInputElement | HTMLTextAreaElement;

/**
 * The DOM holds the text while the field is focused. A parent render must not
 * write an older value back over a character that just landed.
 */
function useFastText<T extends FieldNode>({ value, onDraft, onValue, transform, syncKey }: DraftProps) {
  const nodeRef = useRef<T | null>(null);
  const focused = useRef(false);
  const textRef = useRef(value);
  const initialValue = useRef(value);
  const onDraftRef = useRef(onDraft);
  const onValueRef = useRef(onValue);
  const transformRef = useRef(transform);
  const syncRef = useRef(syncKey);
  const seen = useRef(false);
  onDraftRef.current = onDraft;
  onValueRef.current = onValue;
  transformRef.current = transform;

  useEffect(() => {
    const first = !seen.current;
    seen.current = true;
    const force = syncKey !== syncRef.current;
    syncRef.current = syncKey;
    const node = nodeRef.current;
    if (!node) return;
    if (document.activeElement === node) focused.current = true;
    if (focused.current && !force) {
      if (first && node.value !== value) {
        textRef.current = node.value;
        onDraftRef.current?.(node.value);
        startTransition(() => onValueRef.current(node.value));
      }
      return;
    }
    textRef.current = value;
    if (node.value !== value) node.value = value;
    onDraftRef.current?.(value);
  }, [value, syncKey]);

  function publish(raw: string) {
    const next = transformRef.current ? transformRef.current(raw) : raw;
    const node = nodeRef.current;
    if (node && node.value !== next) node.value = next;
    textRef.current = next;
    onDraftRef.current?.(next);
    startTransition(() => onValueRef.current(next));
  }

  return {
    nodeRef,
    defaultValue: initialValue.current,
    focus() {
      focused.current = true;
    },
    blur() {
      focused.current = false;
      onValueRef.current(textRef.current);
    },
    change(raw: string) {
      publish(raw);
    },
  };
}

type FastInputProps = DraftProps & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue">;

export const FastInput = memo(function FastInput({
  value,
  onDraft,
  onValue,
  transform,
  syncKey,
  onFocus,
  onBlur,
  ...rest
}: FastInputProps) {
  const field = useFastText<HTMLInputElement>({ value, onDraft, onValue, transform, syncKey });
  return (
    <input
      {...rest}
      ref={field.nodeRef}
      defaultValue={field.defaultValue}
      onFocus={(event) => {
        field.focus();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        field.blur();
        onBlur?.(event);
      }}
      onChange={(event) => field.change(event.target.value)}
    />
  );
});

type FastAreaProps = DraftProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "defaultValue">;

export const FastArea = memo(function FastArea({
  value,
  onDraft,
  onValue,
  transform,
  syncKey,
  onFocus,
  onBlur,
  ...rest
}: FastAreaProps) {
  const field = useFastText<HTMLTextAreaElement>({ value, onDraft, onValue, transform, syncKey });
  return (
    <textarea
      {...rest}
      ref={field.nodeRef}
      defaultValue={field.defaultValue}
      onFocus={(event) => {
        field.focus();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        field.blur();
        onBlur?.(event);
      }}
      onChange={(event) => field.change(event.target.value)}
    />
  );
});
