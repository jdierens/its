import { EbayListingsBrowser } from "@/components/EbayListingsBrowser";
import { errorText } from "@/lib/errors";
import { listEbayListings, parseEbayListingQuery, type EbayListingsBrowserResult } from "@/lib/ebay/listingsBrowser";
import { stockSettingsWritable } from "@/lib/stockAccess";

export const dynamic = "force-dynamic";

export default async function EbayListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; match?: string; page?: string }>;
}) {
  const parsed = parseEbayListingQuery(await searchParams);
  const canMatch = await stockSettingsWritable();
  let browser: EbayListingsBrowserResult;
  try {
    browser = await listEbayListings(parsed);
  } catch (error) {
    browser = {
      available: false,
      reason: "error",
      message: errorText(error),
      rows: [],
      total: 0,
      page: parsed.page,
      pageSize: 50,
      q: parsed.q,
      match: parsed.match,
    };
  }

  return (
    <main className="page ebay-listings-page">
      <EbayListingsBrowser browser={browser} canMatch={canMatch} />
    </main>
  );
}
