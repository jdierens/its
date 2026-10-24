"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorText } from "@/lib/errors";
import { fetchItemImages } from "@/lib/images";
import { downloadItemImage, saveEditedImage } from "@/lib/imageUpload";
import {
  autoImproveCanvas,
  canvasFromBlob,
  centeredCrop,
  cleanRemovedAlpha,
  cloneCanvas,
  cropCanvas,
  exportForListing,
  flattenOnWhite,
  redactRect,
  rotateClockwise,
  type PixelRect,
} from "@/lib/photoEdit";

type PhotoEditorProps = {
  itemId: string;
  imageId: string;
};

type CropPreset = "free" | "1:1" | "4:3" | "3:2";
type ToolMode = "view" | "crop" | "redact";
type BackgroundChoice = "white" | "transparent";
type Corner = "nw" | "ne" | "sw" | "se";

const PRESETS: { id: CropPreset; label: string; ratio: number | null }[] = [
  { id: "free", label: "Free", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
];

type Drag =
  | { kind: "move"; origin: PixelRect; startX: number; startY: number }
  | { kind: "draw"; startX: number; startY: number }
  | { kind: "resize"; corner: Corner; origin: PixelRect };

function imagePoint(event: PointerEvent<HTMLElement>, canvas: HTMLCanvasElement): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * canvas.width,
    y: ((event.clientY - box.top) / box.height) * canvas.height,
  };
}

function clampRect(rect: PixelRect, width: number, height: number): PixelRect {
  let nextWidth = Math.max(8, Math.min(rect.w, width));
  let nextHeight = Math.max(8, Math.min(rect.h, height));
  let x = Math.min(Math.max(0, rect.x), width - nextWidth);
  let y = Math.min(Math.max(0, rect.y), height - nextHeight);
  return { x, y, w: nextWidth, h: nextHeight };
}

function resizeRect(origin: PixelRect, corner: Corner, point: { x: number; y: number }, ratio: number | null): PixelRect {
  let x = origin.x;
  let y = origin.y;
  let w = origin.w;
  let h = origin.h;
  if (corner === "se") {
    w = point.x - origin.x;
    h = point.y - origin.y;
  } else if (corner === "nw") {
    w = origin.x + origin.w - point.x;
    h = origin.y + origin.h - point.y;
    x = point.x;
    y = point.y;
  } else if (corner === "ne") {
    w = point.x - origin.x;
    h = origin.y + origin.h - point.y;
    y = point.y;
  } else {
    w = origin.x + origin.w - point.x;
    h = point.y - origin.y;
    x = point.x;
  }
  if (ratio) {
    if (Math.abs(w) / ratio > Math.abs(h)) h = Math.sign(h || 1) * (Math.abs(w) / ratio);
    else w = Math.sign(w || 1) * (Math.abs(h) * ratio);
    if (corner === "nw" || corner === "sw") x = origin.x + origin.w - w;
    if (corner === "nw" || corner === "ne") y = origin.y + origin.h - h;
  }
  if (w < 0) {
    x += w;
    w = Math.abs(w);
  }
  if (h < 0) {
    y += h;
    h = Math.abs(h);
  }
  return { x, y, w, h };
}

export function PhotoEditor({ itemId, imageId }: PhotoEditorProps) {
  const router = useRouter();
  const viewRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const workingRef = useRef<HTMLCanvasElement | null>(null);
  const beforeRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const draftRef = useRef<PixelRect | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [mode, setMode] = useState<ToolMode>("view");
  const [preset, setPreset] = useState<CropPreset>("free");
  const [crop, setCrop] = useState<PixelRect | null>(null);
  const [draft, setDraft] = useState<PixelRect | null>(null);
  const [showingBefore, setShowingBefore] = useState(false);
  const [hasImprove, setHasImprove] = useState(false);
  const [background, setBackground] = useState<BackgroundChoice>("white");
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sizeLabel, setSizeLabel] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const images = await fetchItemImages(itemId);
        const image = images.find((row) => row.id === imageId);
        if (!image) {
          if (!cancelled) setMissing(true);
          return;
        }
        const blob = await downloadItemImage(image.storagePath);
        const canvas = await canvasFromBlob(blob);
        if (cancelled) return;
        workingRef.current = canvas;
        setVersion((current) => current + 1);
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [itemId, imageId]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    const frame = frameRef.current;
    const source = showingBefore ? beforeRef.current : workingRef.current;
    if (!view || !frame || !source) return;
    const context = view.getContext("2d");
    if (!context) return;
    if (view.width !== source.width || view.height !== source.height) {
      view.width = source.width;
      view.height = source.height;
    }
    context.clearRect(0, 0, view.width, view.height);
    context.drawImage(source, 0, 0);
    const maxWidth = frame.parentElement?.clientWidth ?? 900;
    const maxHeight = Math.max(280, window.innerHeight * 0.58);
    const scale = Math.min(maxWidth / source.width, maxHeight / source.height, 1);
    view.style.width = `${Math.round(source.width * scale)}px`;
    view.style.height = `${Math.round(source.height * scale)}px`;
    setSizeLabel(`${source.width} × ${source.height}`);
  }, [version, showingBefore]);

  function bump(next: HTMLCanvasElement) {
    workingRef.current = next;
    beforeRef.current = null;
    setHasImprove(false);
    setShowingBefore(false);
    setCrop(null);
    setDraft(null);
    setMode("view");
    setVersion((current) => current + 1);
  }

  function onAuto() {
    const current = workingRef.current;
    if (!current || busy) return;
    setError(null);
    beforeRef.current = cloneCanvas(current);
    workingRef.current = autoImproveCanvas(current);
    setHasImprove(true);
    setShowingBefore(false);
    setVersion((value) => value + 1);
  }

  function choosePreset(nextPreset: CropPreset) {
    const source = workingRef.current;
    if (!source || showingBefore) return;
    const ratio = PRESETS.find((item) => item.id === nextPreset)?.ratio ?? null;
    setPreset(nextPreset);
    setMode("crop");
    setCrop(centeredCrop(source.width, source.height, ratio));
    setDraft(null);
  }

  function applyCrop() {
    const source = workingRef.current;
    if (!source || !crop) return;
    bump(cropCanvas(source, crop));
  }

  function rotate() {
    const source = workingRef.current;
    if (!source || showingBefore || busy) return;
    bump(rotateClockwise(source));
  }

  async function removeBackground() {
    const source = workingRef.current;
    if (!source || showingBefore || busy) return;
    setBusy(true);
    setError(null);
    setProgress("Loading the background model…");
    try {
      const sourceBlob = await new Promise<Blob>((resolve, reject) => {
        source.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Could not read the photo."));
        }, "image/png");
      });
      const { removeBackground: remove } = await import("@imgly/background-removal");
      const removed = await remove(sourceBlob, {
        model: "isnet_quint8",
        device: "cpu",
        progress: (key, current, total) => {
          const percent = total > 0 ? Math.round((current / total) * 100) : 0;
          const label = key.startsWith("fetch") ? "Downloading the background model" : "Removing the background";
          setProgress(`${label}… ${percent}%`);
        },
      });
      let next = cleanRemovedAlpha(await canvasFromBlob(removed));
      if (background === "white") next = flattenOnWhite(next);
      bump(next);
      setProgress(null);
    } catch (err) {
      setError(errorText(err));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const source = workingRef.current;
    if (!source || busy || showingBefore) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await exportForListing(source, background === "transparent");
      await saveEditedImage({
        itemId,
        sourceImageId: imageId,
        blob,
      });
      router.push(`/items/${itemId}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  function pointOf(event: PointerEvent<HTMLElement>): { x: number; y: number } | null {
    const canvas = viewRef.current;
    if (!canvas) return null;
    return imagePoint(event, canvas);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (showingBefore || busy) return;
    const point = pointOf(event);
    const source = workingRef.current;
    if (!point || !source) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "redact") {
      dragRef.current = { kind: "draw", startX: point.x, startY: point.y };
      const next = { x: point.x, y: point.y, w: 1, h: 1 };
      draftRef.current = next;
      setDraft(next);
      return;
    }
    if (mode !== "crop") return;
    if (crop && point.x >= crop.x && point.x <= crop.x + crop.w && point.y >= crop.y && point.y <= crop.y + crop.h) {
      dragRef.current = { kind: "move", origin: crop, startX: point.x, startY: point.y };
      return;
    }
    if (preset === "free") {
      dragRef.current = { kind: "draw", startX: point.x, startY: point.y };
      setCrop({ x: point.x, y: point.y, w: 1, h: 1 });
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const point = pointOf(event);
    const source = workingRef.current;
    if (!drag || !point || !source) return;
    if (drag.kind === "move") {
      setCrop(
        clampRect(
          {
            x: drag.origin.x + (point.x - drag.startX),
            y: drag.origin.y + (point.y - drag.startY),
            w: drag.origin.w,
            h: drag.origin.h,
          },
          source.width,
          source.height,
        ),
      );
      return;
    }
    if (drag.kind === "resize") {
      const ratio = PRESETS.find((item) => item.id === preset)?.ratio ?? null;
      setCrop(clampRect(resizeRect(drag.origin, drag.corner, point, ratio), source.width, source.height));
      return;
    }
    const rect = {
      x: Math.min(drag.startX, point.x),
      y: Math.min(drag.startY, point.y),
      w: Math.abs(point.x - drag.startX),
      h: Math.abs(point.y - drag.startY),
    };
    if (mode === "redact") {
      draftRef.current = rect;
      setDraft(rect);
    } else setCrop(rect);
  }

  function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    const redaction = draftRef.current;
    if (!drag || mode !== "redact" || !redaction || !workingRef.current) return;
    if (redaction.w > 6 && redaction.h > 6) redactRect(workingRef.current, redaction);
    draftRef.current = null;
    setDraft(null);
    setVersion((current) => current + 1);
  }

  function startResize(event: PointerEvent<HTMLButtonElement>, corner: Corner) {
    event.stopPropagation();
    const frame = frameRef.current;
    if (!crop || !frame) return;
    frame.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "resize", corner, origin: crop };
  }

  const overlay = mode === "redact" ? draft : mode === "crop" ? crop : null;
  const source = showingBefore ? beforeRef.current : workingRef.current;

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Loading photo…</p>
      </main>
    );
  }

  if (missing) {
    return (
      <main className="page">
        <p>Photo not found.</p>
        <Link href={`/items/${itemId}`}>Back to item</Link>
      </main>
    );
  }

  return (
    <main className="page editor-page">
      <div className="page-head">
        <Link className="button secondary" href={`/items/${itemId}`}>
          Back to item
        </Link>
      </div>
      <p className="hint page-note">
        Saving adds a new gallery photo. The original stays as it is. JPEG exports keep the edited
        size, at least 1600 px on the long side when the photo is that large.
        {sizeLabel ? ` Current size: ${sizeLabel}.` : ""}
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {progress ? <p className="banner ok">{progress}</p> : null}

      <div className="editor-tools">
        <div className="actions">
          <button type="button" disabled={busy || showingBefore} onClick={onAuto}>
            Auto-improve
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!hasImprove}
            onClick={() => setShowingBefore((current) => !current)}
          >
            {showingBefore ? "Show improved" : "Show before"}
          </button>
        </div>
        <div className="actions">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={mode === "crop" && preset === item.id ? undefined : "secondary"}
              disabled={busy || showingBefore}
              onClick={() => choosePreset(item.id)}
            >
              {item.label}
            </button>
          ))}
          <button type="button" className="secondary" disabled={!crop || busy || showingBefore} onClick={applyCrop}>
            Apply crop
          </button>
          <button type="button" className="secondary" disabled={busy || showingBefore} onClick={rotate}>
            Rotate 90°
          </button>
        </div>
        <div className="actions">
          <button type="button" disabled={busy || showingBefore} onClick={() => void removeBackground()}>
            {busy && progress ? "Removing…" : "Remove background"}
          </button>
          <label className="check">
            <input
              type="radio"
              name="background"
              checked={background === "white"}
              onChange={() => setBackground("white")}
            />
            White
          </label>
          <label className="check">
            <input
              type="radio"
              name="background"
              checked={background === "transparent"}
              onChange={() => setBackground("transparent")}
            />
            Transparent
          </label>
        </div>
        <div className="actions">
          <button
            type="button"
            className={mode === "redact" ? undefined : "secondary"}
            disabled={busy || showingBefore}
            onClick={() => {
              setMode((current) => (current === "redact" ? "view" : "redact"));
              setCrop(null);
            }}
          >
            Redact
          </button>
          <span className="hint">Drag a rectangle over a serial number or code. The pixels are replaced.</span>
        </div>
      </div>

      <div
        ref={frameRef}
        className="editor-frame"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="editor-stage">
          <canvas ref={viewRef} />
          {overlay && source ? (
            <div
              className={mode === "redact" ? "redact-box" : "crop-box"}
              style={{
                left: `${(overlay.x / source.width) * 100}%`,
                top: `${(overlay.y / source.height) * 100}%`,
                width: `${(overlay.w / source.width) * 100}%`,
                height: `${(overlay.h / source.height) * 100}%`,
              }}
            >
              {mode === "crop"
                ? (["nw", "ne", "sw", "se"] as Corner[]).map((corner) => (
                    <button
                      key={corner}
                      type="button"
                      className={`crop-handle ${corner}`}
                      aria-label={`Resize crop ${corner}`}
                      onPointerDown={(event) => startResize(event, corner)}
                    />
                  ))
                : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="actions editor-save">
        <button type="button" disabled={busy || showingBefore || !workingRef.current} onClick={() => void save()}>
          {busy && !progress ? "Saving…" : "Save as new photo"}
        </button>
        <span className="hint">Saves a new photo just after this one. The first photo stays primary until you reorder.</span>
      </div>
    </main>
  );
}
