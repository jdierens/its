"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type DragEvent, type KeyboardEvent } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { compressImage } from "@/lib/compressImage";
import { errorText } from "@/lib/errors";
import { moveItem } from "@/lib/imageOrder";
import { deleteItemImage, fetchItemImages, imageFileError, reorderItemImages, uploadItemImages } from "@/lib/images";
import type { ItemImage } from "@/lib/types";

export type PendingImage = {
  key: string;
  file: File;
  url: string;
};

type ItemGalleryProps = {
  itemId?: string;
  pending: PendingImage[];
  onPendingChange: (images: PendingImage[]) => void;
};

type Tile = {
  key: string;
  url: string | null;
  name: string;
  edited: boolean;
  editHref: string | null;
};

export function ItemGallery({ itemId, pending, onPendingChange }: ItemGalleryProps) {
  const [images, setImages] = useState<ItemImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [editorHref, setEditorHref] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    fetchItemImages(itemId)
      .then((rows) => {
        if (!cancelled) setImages(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  useEffect(() => {
    if (!focusKey) return;
    document.getElementById(`photo-${focusKey}`)?.focus();
  }, [focusKey, images, pending]);

  const tiles: Tile[] = itemId
    ? images.map((image) => ({
        key: image.id,
        url: image.url,
        name: "Item photo",
        edited: Boolean(image.sourceImageId),
        editHref: `/items/${itemId}/photos/${image.id}`,
      }))
    : pending.map((image) => ({
        key: image.key,
        url: image.url,
        name: image.file.name,
        edited: false,
        editHref: null,
      }));

  async function addFiles(fileList: FileList | null, fromCamera = false) {
    const picked = [...(fileList ?? [])];
    if (picked.length === 0) return;
    setError(null);
    setEditorHref(null);
    let files: File[];
    try {
      files = await Promise.all(picked.map((file) => compressImage(file, fromCamera)));
    } catch (err) {
      setError(errorText(err));
      return;
    }
    const problem = files.map(imageFileError).find(Boolean);
    if (problem) {
      setError(problem);
      return;
    }

    if (!itemId) {
      onPendingChange([
        ...pending,
        ...files.map((file) => ({
          key: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
        })),
      ]);
      return;
    }

    setBusy(true);
    const before = new Set(images.map((image) => image.id));
    try {
      await uploadItemImages(itemId, files);
      const next = await fetchItemImages(itemId);
      setImages(next);
      const added = next.filter((image) => !before.has(image.id));
      const newest = added[added.length - 1];
      if (fromCamera && newest) setEditorHref(`/items/${itemId}/photos/${newest.id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function commitMove(from: number, to: number) {
    if (from < 0 || to < 0 || from === to) return;
    const movedKey = tiles[from]?.key ?? null;
    if (itemId) {
      const next = moveItem(images, from, to);
      setImages(next);
      setFocusKey(movedKey);
      try {
        await reorderItemImages(
          itemId,
          next.map((image) => image.id),
        );
      } catch (err) {
        setError(errorText(err));
        setImages(await fetchItemImages(itemId));
      }
      return;
    }
    onPendingChange(moveItem(pending, from, to));
    setFocusKey(movedKey);
  }

  function onThumbKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -1 : 1;
    void commitMove(index, index + delta);
  }

  function onDrop(event: DragEvent<HTMLLIElement>, targetKey: string) {
    event.preventDefault();
    const fromKey = event.dataTransfer.getData("text/plain") || dragKey;
    setDragKey(null);
    setOverKey(null);
    if (!fromKey || fromKey === targetKey) return;
    void commitMove(
      tiles.findIndex((tile) => tile.key === fromKey),
      tiles.findIndex((tile) => tile.key === targetKey),
    );
  }

  async function confirmDelete() {
    const key = confirmKey;
    if (!key) return;
    if (!itemId) {
      const removed = pending.find((image) => image.key === key);
      if (removed) URL.revokeObjectURL(removed.url);
      onPendingChange(pending.filter((image) => image.key !== key));
      setConfirmKey(null);
      return;
    }
    const image = images.find((row) => row.id === key);
    if (!image) {
      setConfirmKey(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteItemImage(image);
      setImages(await fetchItemImages(itemId));
      setConfirmKey(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset>
      <legend>Photos</legend>
      <div className="gallery-actions">
        <label className="button secondary file-button">
          Add images
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            disabled={busy}
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <label className="button file-button">
          Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(event) => {
              void addFiles(event.target.files, true);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      {editorHref ? (
        <p className="hint">
          <Link href={editorHref}>Edit the photo you just took</Link>
        </p>
      ) : null}
      <p className="hint">
        Take photo opens the phone camera. Add images opens the file picker. The first photo is the primary image. Drag to reorder, or focus a photo and press the left or right arrow.
        {itemId ? " Enter opens the editor." : ""}
      </p>
      {error ? <p className="hint error-text">{error}</p> : null}
      {tiles.length === 0 ? <p className="hint">No photos yet.</p> : null}
      {tiles.length > 0 ? (
        <ul className="gallery">
          {tiles.map((tile, index) => (
            <li
              key={tile.key}
              className={overKey === tile.key ? "drop-target" : undefined}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setOverKey(tile.key);
              }}
              onDragLeave={() => setOverKey((current) => (current === tile.key ? null : current))}
              onDrop={(event) => onDrop(event, tile.key)}
            >
              {tile.editHref ? (
                <Link
                  id={`photo-${tile.key}`}
                  className="thumb-open"
                  href={tile.editHref}
                  draggable={!busy}
                  aria-keyshortcuts="ArrowLeft ArrowRight"
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", tile.key);
                    event.dataTransfer.effectAllowed = "move";
                    setDragKey(tile.key);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  onKeyDown={(event) => onThumbKeyDown(event, index)}
                >
                  <Thumb tile={tile} primary={index === 0} />
                </Link>
              ) : (
                <div
                  id={`photo-${tile.key}`}
                  className="thumb-open"
                  tabIndex={0}
                  role="group"
                  aria-label={tile.name}
                  draggable={!busy}
                  aria-keyshortcuts="ArrowLeft ArrowRight"
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", tile.key);
                    event.dataTransfer.effectAllowed = "move";
                    setDragKey(tile.key);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  onKeyDown={(event) => onThumbKeyDown(event, index)}
                >
                  <Thumb tile={tile} primary={index === 0} />
                </div>
              )}
              <button
                type="button"
                className="thumb-delete"
                aria-label="Delete photo"
                disabled={busy}
                draggable={false}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => setConfirmKey(tile.key)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {confirmKey ? (
        <ConfirmDialog
          title="Delete photo"
          body={itemId ? "This removes the photo from the item. The file is deleted too." : "Remove this photo before the item is saved?"}
          confirmLabel="Delete"
          busy={busy}
          onCancel={() => {
            if (!busy) setConfirmKey(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </fieldset>
  );
}

function Thumb({ tile, primary }: { tile: Tile; primary: boolean }) {
  return (
    <>
      {tile.url ? <img src={tile.url} alt={tile.name} /> : <span className="thumb-missing">No preview</span>}
      {primary || tile.edited ? (
        <span className="thumb-badges">
          {primary ? <span className="badge-primary">Primary</span> : null}
          {tile.edited ? <span className="badge-edited">Edited</span> : null}
        </span>
      ) : null}
    </>
  );
}
