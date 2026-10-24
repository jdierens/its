import { ebayItemUrl } from "@/lib/ebay/itemUrl";
import { ebayListingsForItem } from "@/lib/ebay/listings";
import { getSupabase } from "@/lib/supabase";

export async function ItemEbayListings({ itemId }: { itemId: string }) {
  try {
    const listings = await ebayListingsForItem(await getSupabase(), itemId);
    if (listings === null) return null;
    return (
      <section className="page" id="item-ebay">
        <div className="card item-ebay-card">
          <h2>eBay</h2>
          {listings.length === 0 ? (
            <p className="muted">No active eBay listing is linked to this SKU.</p>
          ) : (
            <ul className="item-ebay-list">
              {listings.map((id) => (
                <li key={id}>
                  <a href={ebayItemUrl(id)} target="_blank" rel="noopener noreferrer">
                    {id}
                  </a>
                </li>
              ))}
            </ul>
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
