import Link from "next/link";
import { ebayItemUrl } from "@/lib/ebay/itemUrl";
import { ebayViewForItem } from "@/lib/ebay/listings";
import { packMark } from "@/lib/ebay/packs";
import { getSupabase } from "@/lib/supabase";

export async function ItemEbayListings({ itemId }: { itemId: string }) {
  try {
    const view = await ebayViewForItem(await getSupabase(), itemId);
    if (view === null) return null;
    const empty = view.direct.length === 0 && view.kits.length === 0;
    return (
      <section className="page" id="item-ebay">
        <div className="card item-ebay-card">
          <h2>eBay</h2>
          {empty ? (
            <p className="muted">No active eBay listing is linked to this SKU.</p>
          ) : (
            <>
              <div className="item-ebay-block">
                <h3>Listed directly</h3>
                {view.direct.length === 0 ? (
                  <p className="muted">Not listed directly.</p>
                ) : (
                  <ul className="item-ebay-list">
                    {view.direct.map((listing) => (
                      <li key={`${listing.ebayItemId}-${listing.packQty}`} className="item-ebay-line">
                        <a href={ebayItemUrl(listing.ebayItemId)} target="_blank" rel="noopener noreferrer">
                          {listing.ebayItemId}
                        </a>
                        <span className="ebay-pack">{packMark(listing.packQty, true)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="item-ebay-block">
                <h3>In kit listings</h3>
                {view.kits.length === 0 ? (
                  <p className="muted">Not used in a kit listing.</p>
                ) : (
                  <ul className="item-ebay-list">
                    {view.kits.map((listing) => {
                      const mark = packMark(listing.packQty);
                      return (
                        <li key={`${listing.ebayItemId}-${listing.kitItemId}`} className="item-ebay-line">
                          <a href={ebayItemUrl(listing.ebayItemId)} target="_blank" rel="noopener noreferrer">
                            {listing.ebayItemId}
                          </a>
                          {mark ? <span className="ebay-pack">{mark}</span> : null}
                          <Link href={`/items/${listing.kitItemId}`}>{listing.kitSku}</Link>
                          <span>
                            {listing.qty} of this item
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load eBay listings.";
    if (/sign in required|SUPABASE_SERVICE_ROLE_KEY/i.test(message)) return null;
    return (
      <section className="page" id="item-ebay">
        <div className="card item-ebay-card">
          <h2>eBay</h2>
          <p className="banner error">{message}</p>
        </div>
      </section>
    );
  }
}
