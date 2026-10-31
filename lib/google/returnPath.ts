const SHEETS_RETURN_PATHS = ["/items", "/admin/integrations/ebay/listings"];

/**
 * Only send the browser back to a list that started a Sheets export.
 * The items list stays the fallback so an unexpected path cannot leave the app.
 */
export function safeItemsReturnPath(value: string | null | undefined): string {
  const fallback = "/items";
  if (!value) return fallback;
  const path = value.trim();
  if (path.includes("\\") || path.includes("://") || path.startsWith("//") || /[\n\r]/.test(path)) return fallback;
  if (path.length > 2000) return fallback;
  const query = path.indexOf("?");
  const pathname = query === -1 ? path : path.slice(0, query);
  if (!SHEETS_RETURN_PATHS.includes(pathname)) return fallback;
  return path;
}
