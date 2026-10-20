const BIN_REFERENCE = /^(\d{5})-([PCB])$/i;
const ITEM_PATH = /\/items\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=[/?#]|$)/i;

export type ScanTarget =
  | { kind: "item"; id: string; sku: string | null }
  | { kind: "sku"; sku: string }
  | { kind: "bin"; reference: string };

/** A scanner burst is a short run of characters with no long pause, ended by Enter. */
export function isScannerBurst(length: number, elapsedMs: number): boolean {
  if (length < 4) return false;
  return elapsedMs >= 0 && elapsedMs < 80 + length * 30;
}

function skuFrom(text: string): string | null {
  const query = text.includes("?") ? text.slice(text.indexOf("?")) : "";
  if (!query) return null;
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const sku = params.get("sku")?.trim();
  return sku || null;
}

/**
 * Item QR codes are `/items/<id>?sku=`. Code 128 is the SKU text.
 * A bin code is `99999-X`, five digits, a hyphen, and P, C, or B.
 */
export function parseScan(raw: string): ScanTarget | null {
  const text = raw.trim();
  if (!text) return null;

  const item = text.match(ITEM_PATH);
  if (item) return { kind: "item", id: item[1], sku: skuFrom(text) };

  if (/^https?:\/\//i.test(text)) return null;

  const bin = text.match(BIN_REFERENCE);
  if (bin) return { kind: "bin", reference: `${bin[1]}-${bin[2].toUpperCase()}` };
  if (/^\d{5}-[A-Za-z]$/.test(text)) return null;

  if (text.length > 80 || /\s/.test(text)) return null;
  return { kind: "sku", sku: text };
}

export function binPath(reference: string): string {
  return `/warehouse/bins/${encodeURIComponent(reference)}`;
}
