"use client";

import { useEffect } from "react";
import {
  LETTER_PRINT_CLASSES,
  letterPrintClass,
  measureLetterPages,
  registerLetterPrint,
  type LetterOrientation,
} from "@/lib/letterPrint";

function clearLetterPrintClass() {
  for (const name of LETTER_PRINT_CLASSES) document.documentElement.classList.remove(name);
}

/** Sets the letter page on `<html>` before the browser paginates. */
export function LetterPrint({
  orientation,
  rootSelector,
  fragmentSelector,
}: {
  orientation: LetterOrientation;
  rootSelector: string;
  fragmentSelector?: string;
}) {
  useEffect(() => {
    function sync() {
      clearLetterPrintClass();
      const root = document.querySelector<HTMLElement>(rootSelector);
      if (!root) return;
      document.documentElement.classList.add(letterPrintClass(orientation, 1));
      const pages = measureLetterPages(root, { orientation, fragmentSelector });
      clearLetterPrintClass();
      document.documentElement.classList.add(letterPrintClass(orientation, pages));
    }

    let active = true;
    function syncIfActive() {
      if (active) sync();
    }

    sync();
    const unregister = registerLetterPrint(sync);
    window.addEventListener("beforeprint", sync);
    void document.fonts?.ready.then(syncIfActive);
    return () => {
      active = false;
      unregister();
      window.removeEventListener("beforeprint", sync);
      clearLetterPrintClass();
    };
  }, [orientation, rootSelector, fragmentSelector]);

  return null;
}
