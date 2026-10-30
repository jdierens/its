import Link from "next/link";
import { Suspense } from "react";
import { EbayListingMatch } from "@/components/EbayListingMatch";
import { EbayListingsExport } from "@/components/EbayListingsExport";
import {
  EBAY_LISTINGS_PAGE_SIZE,
  type EbayListingMatchFilter,
  type EbayListingsBrowserResult,
} from "@/lib/ebay/listingsBrowser";

const FILTERS: { id: EbayListingMatchFilter; label: string }[] = [
  { id: "all", label: "All active" },
  { id: "unmatched", label: "Unmatched" },
  { id: "matched", label: "Matched" },
];

export function EbayListingsBrowser({
  browser,
  canMatch,
  googleConfigured,
}: {
  browser: EbayListingsBrowserResult;
  canMatch: boolean;
  googleConfigured: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(browser.total / EBAY_LISTINGS_PAGE_SIZE));
  const from = browser.total === 0 ? 0 : (browser.page - 1) * EBAY_LISTINGS_PAGE_SIZE + 1;
  const to = Math.min(browser.page * EBAY_LISTINGS_PAGE_SIZE, browser.total);

  return (
    <>
      <p className="page-note">
        Active listings from the last refresh. Matching a row sets the ITS item. It does not change the custom label on eBay.
        Pushing a SKU and ending a listing are not available yet. Export CSV and Open in Google Sheets include every active
        listing that matches the search and filter, not only this page.
      </p>
      <div className="ebay-listings-bar">
        <nav className="ebay-listings-filters" aria-label="Listing match">
          {FILTERS.map((filter) => (
            <Link
              key={filter.id}
              href={listingsHref({ q: browser.q, match: filter.id })}
              aria-current={browser.match === filter.id ? "page" : undefined}
            >
              {filter.label}
            </Link>
          ))}
        </nav>
        <form className="ebay-listings-search" method="get" action="/admin/integrations/ebay/listings">
          <input
            name="q"
            defaultValue={browser.q}
            placeholder="Title, SKU, or eBay item id"
            aria-label="Search listings"
            maxLength={120}
          />
          {browser.match !== "all" ? <input type="hidden" name="match" value={browser.match} /> : null}
          <button type="submit">Search</button>
        </form>
        <Suspense fallback={null}>
          <EbayListingsExport q={browser.q} match={browser.match} googleConfigured={googleConfigured} />
        </Suspense>
      </div>
      {browser.message ? (
        <p className="banner error" role="alert">
          {browser.message}
        </p>
      ) : null}
      {browser.available && browser.total === 0 ? <p className="muted">{emptyText(browser)}</p> : null}
      {browser.available && browser.total > 0 && browser.rows.length === 0 ? (
        <p className="muted">
          No listings on this page. <Link href={listingsHref({ q: browser.q, match: browser.match })}>Back to the first page</Link>
        </p>
      ) : null}
      {browser.rows.length > 0 ? (
        <>
          <p className="hint">
            {from}–{to} of {browser.total}
          </p>
          <div className="card ebay-listings-table">
            <table>
              <thead>
                <tr>
                  <th>Picture</th>
                  <th>Listing</th>
                  <th className="sku">Custom label</th>
                  <th className="num">Qty</th>
                  <th>Item</th>
                </tr>
              </thead>
              <tbody>
                {browser.rows.map((row) => (
                  <ListingRow key={row.id} row={row} canMatch={canMatch} />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="ebay-listings-cards">
            {browser.rows.map((row) => (
              <li className="ebay-listing-card" key={row.id}>
                <ListingBody row={row} canMatch={canMatch} />
              </li>
            ))}
          </ul>
          {pageCount > 1 ? (
            <p className="ebay-listings-pager">
              {browser.page > 1 ? (
                <Link href={listingsHref({ q: browser.q, match: browser.match, page: browser.page - 1 })}>Previous</Link>
              ) : (
                <span className="muted">Previous</span>
              )}
              <span>
                Page {browser.page} of {pageCount}
              </span>
              {browser.page < pageCount ? (
                <Link href={listingsHref({ q: browser.q, match: browser.match, page: browser.page + 1 })}>Next</Link>
              ) : (
                <span className="muted">Next</span>
              )}
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function ListingRow({
  row,
  canMatch,
}: {
  row: EbayListingsBrowserResult["rows"][number];
  canMatch: boolean;
}) {
  return (
    <tr>
      <td>{picture(row)}</td>
      <td>
        <a href={row.listingUrl} target="_blank" rel="noreferrer">
          {row.title || row.ebayItemId}
        </a>
        <span className="hint ebay-item-id">{row.ebayItemId}</span>
      </td>
      <td className="sku">
        <span className="sku">{row.customLabel || "—"}</span>
        {row.packQty > 1 ? <span className="code-badge">{row.packQty}x</span> : null}
        {row.parentSku ? <span className="hint">Parent {row.parentSku}</span> : null}
      </td>
      <td className="num">{row.quantityAvailable ?? "—"}</td>
      <td>
        <ItemCell row={row} canMatch={canMatch} />
      </td>
    </tr>
  );
}

function ListingBody({
  row,
  canMatch,
}: {
  row: EbayListingsBrowserResult["rows"][number];
  canMatch: boolean;
}) {
  return (
    <>
      <div className="ebay-listing-card-head">
        {picture(row)}
        <div>
          <a href={row.listingUrl} target="_blank" rel="noreferrer">
            {row.title || row.ebayItemId}
          </a>
          <span className="hint ebay-item-id">{row.ebayItemId}</span>
        </div>
      </div>
      <dl>
        <dt>Custom label</dt>
        <dd>
          <span className="sku">{row.customLabel || "—"}</span>
          {row.packQty > 1 ? <span className="code-badge">{row.packQty}x</span> : null}
        </dd>
        <dt>Qty</dt>
        <dd className="num">{row.quantityAvailable ?? "—"}</dd>
        <dt>Item</dt>
        <dd>
          <ItemCell row={row} canMatch={canMatch} />
        </dd>
      </dl>
    </>
  );
}

function ItemCell({
  row,
  canMatch,
}: {
  row: EbayListingsBrowserResult["rows"][number];
  canMatch: boolean;
}) {
  if (row.itemId) {
    return (
      <>
        <Link href={`/items/${row.itemId}`}>
          <span className="sku">{row.itemSku || "Item"}</span>
          {row.itemName ? ` ${row.itemName}` : ""}
        </Link>
        {row.matchedManually ? <span className="hint">Kept on refresh</span> : null}
        <LaterActions />
      </>
    );
  }
  return (
    <>
      <span className="muted">No item</span>
      {canMatch ? <EbayListingMatch listingId={row.id} /> : <span className="hint">Only an admin can match a listing.</span>}
      <LaterActions />
    </>
  );
}

function LaterActions() {
  return (
    <details className="ebay-listing-later">
      <summary>Listing actions</summary>
      <p className="hint">Pushing a SKU and ending a listing on eBay are not available yet.</p>
      <button type="button" disabled title="Not available yet. This does not change the listing on eBay.">
        Push SKU
      </button>
      <button type="button" disabled title="Not available yet. This does not end the listing on eBay.">
        End listing
      </button>
    </details>
  );
}

function picture(row: EbayListingsBrowserResult["rows"][number]) {
  if (row.imageUrl) {
    return <img className="ebay-listing-photo" src={row.imageUrl} alt="" />;
  }
  return (
    <span className="ebay-listing-photo missing" aria-hidden>
      —
    </span>
  );
}

function emptyText(browser: EbayListingsBrowserResult): string {
  if (browser.q) return "No active listings match that search.";
  if (browser.match === "unmatched") return "Every active listing is matched to an item.";
  if (browser.match === "matched") return "No active listings are matched to an item.";
  return "No active listings yet. Refresh listings on the eBay page.";
}

function listingsHref(input: { q: string; match: EbayListingMatchFilter; page?: number }): string {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.match !== "all") params.set("match", input.match);
  if (input.page && input.page > 1) params.set("page", String(input.page));
  const query = params.toString();
  return query ? `/admin/integrations/ebay/listings?${query}` : "/admin/integrations/ebay/listings";
}
