import { randomUUID } from "node:crypto";
import { tradingUrl, type EbayEnvironment } from "@/lib/ebay/endpoints";

export const TRADING_COMPATIBILITY_LEVEL = "1231";
export const ACTIVE_LIST_PAGE_SIZE = 200;
const MAX_TEXT = 500;

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
  const fetchImpl = input.fetchImpl ?? fetch;
  let token = input.token;
  let refreshed = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestId = randomUUID();
    const response = await fetchImpl(tradingUrl(input.environment), {
      method: "POST",
      headers: {
        "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
        "X-EBAY-API-IAF-TOKEN": token,
        "Content-Type": "text/xml",
        "X-EBAY-C-REQUEST-ID": requestId,
      },
      body: activeListRequestXml(input.page, input.entriesPerPage),
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
      throw new TradingCallError(parsed.error || `eBay listings request failed (${response.status}).`, ids);
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
  const pictureUrl = safeHttpsUrl(tagText(shell, "PictureURL") ?? tagText(shell, "GalleryURL"));
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
  if (!clipped || !/^https:\/\/[^\s]+$/i.test(clipped)) return null;
  return clipped;
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
