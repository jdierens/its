"use client";

import Link from "next/link";
import { Check, Loader2, Save, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  isGuardedNavigation,
  isSaveShortcut,
  LEAVE_WITHOUT_SAVING,
  type LeaveAnchor,
} from "@/lib/formDirty";

const SAVE_LABEL = "Save (Ctrl/Cmd+S)";

export function PageToolbar({
  dirty,
  saving,
  saved,
  onSave,
  disabled = false,
  listen = true,
  leaveMessage = LEAVE_WITHOUT_SAVING,
  children,
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  disabled?: boolean;
  listen?: boolean;
  leaveMessage?: string;
  children?: ReactNode;
}) {
  const canSave = dirty && !saving && !disabled;
  const saveRef = useRef(onSave);
  const canSaveRef = useRef(canSave);
  const listenRef = useRef(listen);
  const dirtyRef = useRef(dirty);
  const messageRef = useRef(leaveMessage);
  saveRef.current = onSave;
  canSaveRef.current = canSave;
  listenRef.current = listen;
  dirtyRef.current = dirty;
  messageRef.current = leaveMessage;

  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (!saved || dirty || saving) {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const timer = window.setTimeout(() => setShowSaved(false), 1600);
    return () => window.clearTimeout(timer);
  }, [saved, dirty, saving]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isSaveShortcut(event)) return;
      event.preventDefault();
      if (!listenRef.current || !canSaveRef.current) return;
      saveRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onLeave(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!dirtyRef.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      const described: LeaveAnchor | null = anchor
        ? {
            href: anchor.getAttribute("href"),
            target: anchor.getAttribute("target"),
            download: anchor.hasAttribute("download"),
          }
        : null;
      if (!isGuardedNavigation(event, described)) return;
      if (window.confirm(messageRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const status = saving ? "Saving" : dirty ? "Unsaved changes" : showSaved ? "Saved" : "";

  return (
    <div className="page-toolbar no-print">
      <div className="toolbar-cluster">
        <button
          type="button"
          className={`icon-button toolbar-save${saving ? " saving" : ""}${showSaved ? " saved" : ""}`}
          title={SAVE_LABEL}
          aria-label={SAVE_LABEL}
          disabled={!canSave}
          onClick={onSave}
        >
          {saving ? (
            <Loader2 className="icon-spin" size={18} strokeWidth={1.75} aria-hidden />
          ) : showSaved ? (
            <Check size={18} strokeWidth={1.75} aria-hidden />
          ) : (
            <Save size={18} strokeWidth={1.75} aria-hidden />
          )}
          {dirty && !saving ? <span className="unsaved-dot" aria-hidden /> : null}
        </button>
        <span className="sr-only" role="status">
          {status}
        </span>
      </div>
      {children ? <div className="toolbar-cluster">{children}</div> : <span />}
    </div>
  );
}

export function ToolbarButton({
  label,
  icon: Icon,
  onClick,
  href,
  disabled = false,
  danger = false,
  busy = false,
}: {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  danger?: boolean;
  busy?: boolean;
}) {
  const className = `icon-button${danger ? " danger" : ""}`;
  const icon = busy ? (
    <Loader2 className="icon-spin" size={18} strokeWidth={1.75} aria-hidden />
  ) : (
    <Icon size={18} strokeWidth={1.75} aria-hidden />
  );
  if (href && !disabled && !busy) {
    return (
      <Link className={className} href={href} title={label} aria-label={label}>
        {icon}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      title={label}
      aria-label={label}
      disabled={disabled || busy}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

export function ToolbarSeparator() {
  return <span className="toolbar-sep" aria-hidden />;
}
