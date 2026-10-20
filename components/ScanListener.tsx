"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { errorText } from "@/lib/errors";
import { openScan } from "@/lib/openScan";
import { isScannerBurst } from "@/lib/scan";

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** A USB or Bluetooth scanner types a code and presses Enter. That opens the item or bin. */
export function ScanListener() {
  const router = useRouter();

  useEffect(() => {
    let buffer = "";
    let started = 0;

    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || typingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Enter") {
        const value = buffer;
        const elapsed = buffer ? Date.now() - started : 0;
        buffer = "";
        if (!isScannerBurst(value.length, elapsed)) return;
        event.preventDefault();
        openScan(value)
          .then((href) => router.push(href))
          .catch((error: unknown) => {
            const message = errorText(error);
            router.push(`/scan?code=${encodeURIComponent(value)}&error=${encodeURIComponent(message)}`);
          });
        return;
      }
      if (event.key.length !== 1) return;
      const now = Date.now();
      if (!buffer || now - started > 80 + buffer.length * 30) {
        buffer = "";
        started = now;
      }
      buffer += event.key;
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return null;
}
