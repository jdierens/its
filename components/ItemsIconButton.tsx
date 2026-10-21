"use client";

import Link from "next/link";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

const HOLD_MS = 480;

export function ItemsIconButton({
  label,
  icon: Icon,
  variant = "secondary",
  disabled = false,
  href,
  onClick,
  pressed = false,
  popup,
}: {
  label: string;
  icon: LucideIcon;
  variant?: "default" | "secondary";
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
  pressed?: boolean;
  popup?: "dialog";
}) {
  const [heldOpen, setHeldOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const held = useRef(false);

  function clearTimer() {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.pointerType === "mouse") return;
    held.current = false;
    clearTimer();
    timer.current = window.setTimeout(() => {
      held.current = true;
      setHeldOpen(true);
    }, HOLD_MS);
  }

  function onPointerUp() {
    clearTimer();
    if (!held.current) return;
    window.setTimeout(() => setHeldOpen(false), 900);
  }

  function onPointerLeave() {
    if (held.current) return;
    clearTimer();
  }

  function onPointerCancel() {
    clearTimer();
    held.current = false;
    setHeldOpen(false);
  }

  const className = cn("button", "items-icon", variant === "secondary" && "secondary");
  const showTip = !pressed;
  const control = href ? (
    <Link href={href} className={className} aria-label={label} onClick={onClick}>
      <Icon size={18} strokeWidth={1.75} aria-hidden />
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-expanded={popup ? pressed : undefined}
      aria-haspopup={popup}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden />
    </button>
  );

  return (
    <span
      className={heldOpen ? "items-tip-wrap is-open" : "items-tip-wrap"}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
      onClickCapture={(event) => {
        if (!held.current) return;
        event.preventDefault();
        event.stopPropagation();
        held.current = false;
      }}
    >
      {control}
      {showTip ? (
        <span className="items-tip" role="tooltip">
          {label}
        </span>
      ) : null}
    </span>
  );
}
