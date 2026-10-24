"use client";

import Link from "next/link";
import { useState } from "react";
import { ebayItemUrl } from "@/lib/ebay/itemUrl";
import { kitListingLabel, packMark } from "@/lib/ebay/packs";

type DirectListing = { ebayItemId: string; packQty: number };
type KitListing = {
  ebayItemId: string;
  kitItemId: string;
  kitSku: string;
  packQty: number;
  qty: number;
};

function stop(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function ListingId({ id, packQty }: { id: string; packQty: number }) {
  const mark = packMark(packQty);
  return (
    <a href={ebayItemUrl(id)} target="_blank" rel="noopener noreferrer" onClick={stop} onDoubleClick={stop}>
      {id}
      {mark ? <span className="ebay-pack"> {mark}</span> : null}
    </a>
  );
}

export function EbayItemIds({ listings, kitListings }: { listings: DirectListing[]; kitListings: KitListing[] }) {
  const [idsOpen, setIdsOpen] = useState(false);
  const [kitsOpen, setKitsOpen] = useState(false);
  if (listings.length === 0 && kitListings.length === 0) return "—";
  const [first, ...rest] = listings;
  return (
    <span className="ebay-ids">
      {first ? <ListingId id={first.ebayItemId} packQty={first.packQty} /> : null}
      {rest.length > 0 ? (
        <button
          type="button"
          className="ebay-more"
          aria-expanded={idsOpen}
          onClick={(event) => {
            stop(event);
            setIdsOpen((current) => !current);
          }}
          onDoubleClick={stop}
        >
          +{rest.length}
        </button>
      ) : null}
      {idsOpen
        ? rest.map((listing) => (
            <ListingId key={`${listing.ebayItemId}-${listing.packQty}`} id={listing.ebayItemId} packQty={listing.packQty} />
          ))
        : null}
      {kitListings.length > 0 ? (
        <button
          type="button"
          className="ebay-more"
          aria-expanded={kitsOpen}
          onClick={(event) => {
            stop(event);
            setKitsOpen((current) => !current);
          }}
          onDoubleClick={stop}
        >
          {kitListingLabel(kitListings.length)}
        </button>
      ) : null}
      {kitsOpen ? (
        <span className="ebay-kit-list">
          {kitListings.map((listing) => (
            <span key={`${listing.ebayItemId}-${listing.kitItemId}`} className="ebay-kit-row">
              <ListingId id={listing.ebayItemId} packQty={listing.packQty} />
              <Link href={`/items/${listing.kitItemId}`} onClick={stop} onDoubleClick={stop}>
                {listing.kitSku}
              </Link>
              <span>
                {listing.qty} of this item
              </span>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
