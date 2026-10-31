import { randomUUID } from "node:crypto";
import { tradingUrl, type EbayEnvironment } from "@/lib/ebay/endpoints";

export const TRADING_COMPATIBILITY_LEVEL = "1231";
export const ACTIVE_LIST_PAGE_SIZE = 200;
const MAX_TEXT = 500;
const MAX_LIST_PAGES = 500;
/** eBay rejects an end-time window of 120 days or more. */
const SELLER_LIST_WINDOW_DAYS = 119;
const EBAY_IMAGE_HOST = /^(?:[a-z0-9-]+\.)*(?:ebayimg|ebaystatic)\.com$/i;

const AUTH_ERROR_CODES = new Set(["931", "17470", "21917053"]);

export type ActiveListing = {
  ebayItemId: string;
  sku: string | null;
  variationSku: string | null;
  title: string | null;
  pictureUrl: string | null;
  quantityAvailable: number | null;
  listingStatus: string;
  listingUrl: string | null;
};

export type ActiveListPage = {
  ack: string;
  error: string | null;
  errorCode: string | null;
  totalPages: number;
  rows: ActiveListing[];
};

export class TradingCallError extends Error {
  readonly rlogid: string | null;
  readonly requestId: string | null;

  constructor(message: string, ids: { rlogid: string | null; requestId: string | null }) {
    super(message);
    this.name = "TradingCallError";
    this.rlogid = ids.rlogid;
    this.requestId = ids.requestId;
  }
}

const NS = String.raw`(?:[\w.-]+:)?`;

export function activeListRequestXml(page: number, entriesPerPage = ACTIVE_LIST_PAGE_SIZE): string {
  const pageNumber = Math.max(1, Math.floor(page));
  const entries = Math.max(1, Math.min(200, Math.floor(entriesPerPage)));
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <DetailLevel>ReturnAll</DetailLevel>
  <HideVariations>false</HideVariations>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${entries}</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`;
}

export function sellerListWindow(now: Date): { endTimeFrom: string; endTimeTo: string } {
  const endTimeFrom = now.toISOString();
  const endTimeTo = new Date(now.getTime() + SELLER_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { endTimeFrom, endTimeTo };
}

// ActiveList omits PictureURL. GetSellerList at Coarse returns PictureDetails, including PictureURL.
export function sellerListRequestXml(
  page: number,
  endTimeFrom: string,
  endTimeTo: string,
  entriesPerPage = ACTIVE_LIST_PAGE_SIZE,
): string {
  const pageNumber = Math.max(1, Math.floor(page));
  const entries = Math.max(1, Math.min(200, Math.floor(entriesPerPage)));
  return `<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <GranularityLevel>Coarse</GranularityLevel>
  <IncludeVariations>false</IncludeVariations>
  <EndTimeFrom>${utcTimestamp(endTimeFrom)}</EndTimeFrom>
  <EndTimeTo>${utcTimestamp(endTimeTo)}</EndTimeTo>
  <Pagination>
    <EntriesPerPage>${entries}</EntriesPerPage>
    <PageNumber>${pageNumber}</PageNumber>
  </Pagination>
</GetSellerListRequest>`;
}

export function parseActiveList(xml: string): ActiveListPage {
  const ack = tagText(xml, "Ack") ?? "";
  const errorBlock = firstBlock(xml, "Errors");
  const error = errorBlock ? tagText(errorBlock, "LongMessage") ?? tagText(errorBlock, "ShortMessage") : null;
  const errorCode = errorBlock ? tagText(errorBlock, "ErrorCode") : null;
  const pagination = firstBlock(xml, "PaginationResult");
  const totalPages = integer(pagination ? tagText(pagination, "TotalNumberOfPages") : null) ?? 0;
  const rows = blocks(xml, "Item").flatMap(parseItem);
  return { ack, error, errorCode, totalPages, rows };
}

export async function fetchActiveListPage(input: {
  environment: EbayEnvironment;
  token: string;
  page: number;
  entriesPerPage?: number;
  refresh?: () => Promise<string>;
  fetchImpl?: typeof fetch;
}): Promise<{ page: ActiveListPage; token: string; rlogid: string | null; requestId: string | null }> {
  return postTrading({
    callName: "GetMyeBaySelling",
    body: activeListRequestXml(input.page, input.entriesPerPage),
    environment: input.environment,
    token: input.token,
    refresh: input.refresh,
    fetchImpl: input.fetchImpl,
    failure: "eBay listings request failed",
  });
}

export async function fetchSellerListPictures(input: {
  environment: EbayEnvironment;
  token: string;
  now?: Date;
  entriesPerPage?: number;
  refresh?: () => Promise<string>;
  fetchImpl?: typeof fetch;
}): Promise<{ pictures: Map<string, string>; token: string; rlogid: string | null; requestId: string | null }> {
  const entriesPerPage = input.entriesPerPage ?? ACTIVE_LIST_PAGE_SIZE;
  const window = sellerListWindow(input.now ?? new Date());
  const pictures = new Map<string, string>();
  let token = input.token;
  let totalPages = 1;
  let rlogid: string | null = null;
  let requestId: string | null = null;

  for (let page = 1; page <= totalPages && page <= MAX_LIST_PAGES; page += 1) {
    const result = await postTrading({
      callName: "GetSellerList",
      body: sellerListRequestXml(page, window.endTimeFrom, window.endTimeTo, entriesPerPage),
      environment: input.environment,
      token,
      refresh: input.refresh,
      fetchImpl: input.fetchImpl,
      failure: "eBay picture request failed",
    });
    token = result.token;
    rlogid = result.rlogid ?? rlogid;
    requestId = result.requestId ?? requestId;
    for (const row of result.page.rows) {
      if (row.pictureUrl) pictures.set(row.ebayItemId, row.pictureUrl);
    }
    if (result.page.totalPages > 0) totalPages = result.page.totalPages;
    else if (result.page.rows.length >= entriesPerPage) totalPages = page + 1;
    if (result.page.rows.length === 0) break;
  }

  return { pictures, token, rlogid, requestId };
}

async function postTrading(input: {
  callName: string;
  body: string;
  environment: EbayEnvironment;
  token: string;
  refresh?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  failure: string;
}): Promise<{ page: ActiveListPage; token: string; rlogid: string | null; requestId: string | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let token = input.token;
  let refreshed = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestId = randomUUID();
    const response = await fetchImpl(tradingUrl(input.environment), {
      method: "POST",
      headers: {
        "X-EBAY-API-CALL-NAME": input.callName,
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
        "X-EBAY-API-IAF-TOKEN": token,
        "Content-Type": "text/xml",
        "X-EBAY-C-REQUEST-ID": requestId,
      },
      body: input.body,
      signal: AbortSignal.timeout(60_000),
    });
    const ids = {
      rlogid: response.headers.get("rlogid"),
      requestId: response.headers.get("x-ebay-c-request-id") || requestId,
    };
    const xml = await response.text();
    if (response.status === 401 && input.refresh && !refreshed) {
      refreshed = true;
      token = await input.refresh();
      continue;
    }
    const parsed = parseActiveList(xml);
    const failed = !response.ok || parsed.ack === "Failure" || parsed.ack === "PartialFailure";
    if (
      failed &&
      parsed.errorCode &&
      AUTH_ERROR_CODES.has(parsed.errorCode) &&
      input.refresh &&
      !refreshed
    ) {
      refreshed = true;
      token = await input.refresh();
      continue;
    }
    if (failed) {
      throw new TradingCallError(parsed.error || `${input.failure} (${response.status}).`, ids);
    }
    return { page: parsed, token, rlogid: ids.rlogid, requestId: ids.requestId };
  }

  throw new TradingCallError("eBay rejected the access token.", { rlogid: null, requestId: null });
}

function parseItem(itemXml: string): ActiveListing[] {
  const ebayItemId = digits(tagText(itemXml, "ItemID"));
  if (!ebayItemId) return [];
  const shell = without(itemXml, "Variations");
  const sku = clip(tagText(shell, "SKU"));
  const title = clip(tagText(shell, "Title"));
  const pictureUrl = itemPictureUrl(shell);
  const listingStatus = clip(tagText(shell, "ListingStatus")) ?? "Active";
  const listingUrl = publicItemUrl(tagText(shell, "ViewItemURL"), ebayItemId);
  const variations = blocks(itemXml, "Variation");
  if (variations.length === 0) {
    return [
      {
        ebayItemId,
        sku,
        variationSku: null,
        title,
        pictureUrl,
        quantityAvailable: integer(tagText(shell, "QuantityAvailable")) ?? integer(tagText(shell, "Quantity")),
        listingStatus,
        listingUrl,
      },
    ];
  }
  return variations.map((variation) => ({
    ebayItemId,
    sku,
    variationSku: clip(tagText(variation, "SKU")),
    title,
    pictureUrl,
    quantityAvailable: integer(tagText(variation, "QuantityAvailable")) ?? integer(tagText(variation, "Quantity")),
    listingStatus,
    listingUrl,
  }));
}

export function safeHttpsUrl(value: string | null): string | null {
  const clipped = clip(value);
  if (!clipped) return null;
  const upgraded = httpsEbayImage(clipped);
  if (!/^https:\/\/[^\s]+$/i.test(upgraded)) return null;
  return upgraded;
}

function itemPictureUrl(shell: string): string | null {
  const details = firstBlock(shell, "PictureDetails");
  if (details) {
    const fromDetails = safeHttpsUrl(tagText(details, "PictureURL") ?? tagText(details, "GalleryURL"));
    if (fromDetails) return fromDetails;
  }
  return safeHttpsUrl(tagText(shell, "PictureURL") ?? tagText(shell, "GalleryURL"));
}

function httpsEbayImage(value: string): string {
  const http = value.match(/^http:\/\/([^/\s]+)(\/\S*)?$/i);
  if (!http || !EBAY_IMAGE_HOST.test(http[1] ?? "")) return value;
  return `https://${http[1]}${http[2] ?? ""}`;
}

function utcTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error("eBay time window is not a UTC timestamp.");
  }
  return value;
}

function publicItemUrl(value: string | null, ebayItemId: string): string {
  if (value && /^https:\/\/[^\s]+$/i.test(value)) return value.slice(0, MAX_TEXT);
  return `https://www.ebay.com/itm/${ebayItemId}`;
}

function digits(value: string | null): string | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return value;
}

function integer(value: string | null): number | null {
  if (!value || !/^-?\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function clip(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TEXT);
}

function tagText(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${NS}${name}\\b[^>]*>([\\s\\S]*?)</${NS}${name}>`, "i"));
  if (!match) return null;
  const inner = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[\s\S]*?>/g, "");
  const text = decodeXml(inner).trim();
  return text.length > 0 ? text : null;
}

function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${NS}${name}\\b[^>]*>([\\s\\S]*?)</${NS}${name}>`, "gi"))].map(
    (match) => match[1] ?? "",
  );
}

function firstBlock(xml: string, name: string): string | null {
  return blocks(xml, name)[0] ?? null;
}

function without(block: string, name: string): string {
  return block.replace(new RegExp(`<${NS}${name}\\b[^>]*>[\\s\\S]*?</${NS}${name}>`, "gi"), "");
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
