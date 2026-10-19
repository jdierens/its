export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return [...items];
  next.splice(to, 0, item);
  return next;
}

export function appendSortStart(sortOrders: readonly number[]): number {
  if (sortOrders.length === 0) return 0;
  return Math.max(...sortOrders) + 1;
}

export function sortOrderAfterSource(
  images: readonly { id: string; sortOrder: number }[],
  sourceId: string,
): number {
  const source = images.find((image) => image.id === sourceId);
  if (!source) return appendSortStart(images.map((image) => image.sortOrder));
  return source.sortOrder + 1;
}

export function shiftedSortOrders(
  images: readonly { id: string; sortOrder: number }[],
  insertAt: number,
): { id: string; sortOrder: number }[] {
  return images
    .filter((image) => image.sortOrder >= insertAt)
    .sort((a, b) => b.sortOrder - a.sortOrder)
    .map((image) => ({ id: image.id, sortOrder: image.sortOrder + 1 }));
}

export function orderByCreatedAt<T extends { id: string; createdAt: string }>(images: readonly T[]): T[] {
  return [...images].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export function primaryStoragePath(
  images: readonly { storage_path: string; sort_order: number }[] | null,
): string | null {
  if (!images || images.length === 0) return null;
  const first = images.reduce((best, image) => (image.sort_order < best.sort_order ? image : best));
  return first.storage_path;
}
