export function ebayItemUrl(ebayItemId: string): string {
  return `https://www.ebay.com/itm/${encodeURIComponent(ebayItemId)}`;
}
