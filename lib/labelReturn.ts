const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function itemId(value: string | null | undefined): string | null {
  if (!value || !ITEM_ID.test(value)) return null;
  return value;
}

/** Item page to reopen from the label desk. The first real id wins. */
export function labelItemBackHref(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const id = itemId(candidate);
    if (id) return `/items/${id}`;
  }
  return null;
}

/** Address the item toolbar uses. `from` is the item to return to. */
export function itemLabelHref(itemIdValue: string | null, sku: string): string {
  const id = itemId(itemIdValue);
  const trimmed = sku.trim();
  if (trimmed && id) {
    return `/labels?sku=${encodeURIComponent(trimmed)}&from=${encodeURIComponent(id)}`;
  }
  if (trimmed) return `/labels?sku=${encodeURIComponent(trimmed)}`;
  if (id) return `/labels?id=${encodeURIComponent(id)}`;
  return "/labels";
}
