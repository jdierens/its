"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorText } from "@/lib/errors";
import {
  deleteItemImage,
  fetchItemImages,
  imageFileError,
  setPrimaryImage,
  uploadItemImages,
} from "@/lib/images";
import type { ItemImage } from "@/lib/types";

export type PendingImage = {
  key: string;
  file: File;
  url: string;
  isPrimary: boolean;
};

type ItemGalleryProps = {
  itemId?: string;
  pending: PendingImage[];
  onPendingChange: (images: PendingImage[]) => void;
};

export function ItemGallery({ itemId, pending, onPendingChange }: ItemGalleryProps) {
  const [images, setImages] = useState<ItemImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function addFiles(fileList: FileList | null) {
    const files = [...(fileList ?? [])];
    if (files.length === 0) return;
    const problem = files.map(imageFileError).find(Boolean);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);

    if (!itemId) {
      const next = [...pending];
      for (const file of files) {
        next.push({
          key: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
          isPrimary: next.length === 0,
        });
      }
      if (!next.some((image) => image.isPrimary) && next[0]) next[0].isPrimary = true;
      onPendingChange(next);
      return;
    }

    setBusy(true);
    try {
      const hasPrimary = images.some((image) => image.isPrimary);
      await uploadItemImages(
        itemId,
        files.map((file, index) => ({
          file,
          isPrimary: !hasPrimary && index === 0,
        })),
      );
      setImages(await fetchItemImages(itemId));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeSaved(image: ItemImage) {
    if (!itemId) return;
    setBusy(true);
    setError(null);
    try {
      await deleteItemImage(image);
      setImages(await fetchItemImages(itemId));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function makePrimary(image: ItemImage) {
    if (!itemId) return;
    setBusy(true);
    setError(null);
    try {
      await setPrimaryImage(image);
      setImages(await fetchItemImages(itemId));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function removePending(key: string) {
    const next = pending.filter((image) => image.key !== key);
    const removed = pending.find((image) => image.key === key);
    if (removed) URL.revokeObjectURL(removed.url);
    if (removed?.isPrimary && next[0]) next[0].isPrimary = true;
    onPendingChange(next);
  }

  function makePendingPrimary(key: string) {
    onPendingChange(pending.map((image) => ({ ...image, isPrimary: image.key === key })));
  }

  const tiles = itemId
    ? images.map((image) => ({
        key: image.id,
        url: image.url,
        name: "Item photo",
        isPrimary: image.isPrimary,
        edited: Boolean(image.sourceImageId),
        editHref: `/items/${itemId}/photos/${image.id}`,
        onDelete: () => void removeSaved(image),
        onPrimary: () => void makePrimary(image),
      }))
    : pending.map((image) => ({
        key: image.key,
        url: image.url,
        name: image.file.name,
        isPrimary: image.isPrimary,
        edited: false,
        editHref: null,
        onDelete: () => removePending(image.key),
        onPrimary: () => makePendingPrimary(image.key),
      }));

  return (
    <fieldset>
      <legend>Photos</legend>
      <label>
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
      {error ? <p className="hint error-text">{error}</p> : null}
      {tiles.length === 0 ? <p className="hint">No photos yet.</p> : null}
      {tiles.length > 0 ? (
        <ul className="gallery">
          {tiles.map((tile) => (
            <li key={tile.key}>
              {tile.url ? (
                <img src={tile.url} alt={tile.name} />
              ) : (
                <span className="thumb-missing">No preview</span>
              )}
              <div className="gallery-actions">
                {tile.isPrimary ? <span className="hint">Primary</span> : null}
                {tile.edited ? <span className="hint">Edited</span> : null}
                {tile.editHref ? (
                  <Link className="button secondary" href={tile.editHref}>
                    Edit
                  </Link>
                ) : null}
                {!tile.isPrimary ? (
                  <button type="button" className="secondary" disabled={busy} onClick={tile.onPrimary}>
                    Make primary
                  </button>
                ) : null}
                <button type="button" className="secondary" disabled={busy} onClick={tile.onDelete}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}
