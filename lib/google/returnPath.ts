/** Only send the browser back to the items list. */
export function safeItemsReturnPath(value: string | null | undefined): string {
  if (!value) return "/items";
  const path = value.trim();
  if (path !== "/items" && !path.startsWith("/items?")) return "/items";
  if (path.includes("\\") || path.includes("://") || /[\n\r]/.test(path)) return "/items";
  if (path.length > 2000) return "/items";
  return path;
}
