const MESSAGE = "Product page must be an http or https URL.";

export function productUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return MESSAGE;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || /\s/.test(trimmed)) {
    return MESSAGE;
  }
  return null;
}

export function productUrlHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || productUrlError(trimmed)) return null;
  return trimmed;
}
