import { fetchNextSkuPreview } from "@/lib/skuServer";

// An untouched preview is not the saved SKU. The server assigns the number
// inside create_item. A typed value is saved as written.
export function skuSubmittedForCreate(edited: boolean, sku: string): string {
  if (!edited) return "";
  return sku.trim();
}

export function previewNewItemSku(): Promise<string> {
  return fetchNextSkuPreview();
}
