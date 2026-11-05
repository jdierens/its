import Link from "next/link";
import { notFound } from "next/navigation";
import { QuoteDocument } from "@/components/QuoteDocument";
import { errorText } from "@/lib/errors";
import { originatorDisplay, QUOTE_REVIEWS_PATH, QUOTE_REVIEWS_SETUP } from "@/lib/quoteReviews";
import { listQuoteCustomers, listQuoteProspects, listQuoteVendors, loadQuoteReview } from "@/lib/quoteReviewsServer";

export const dynamic = "force-dynamic";

export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const detail = await loadQuoteReview(id);
    if (detail.status === "unavailable") {
      return (
        <main className="page so-page ds">
          <p className="banner warn" role="status">
            {QUOTE_REVIEWS_SETUP}
          </p>
        </main>
      );
    }
    if (detail.status === "missing") notFound();
    const { draft } = detail;
    const [vendors, customers, prospects] = await Promise.all([
      draft.vendorId ? listQuoteVendors({ keepIds: [draft.vendorId] }) : Promise.resolve([]),
      draft.customerId ? listQuoteCustomers({ keepIds: [draft.customerId] }) : Promise.resolve([]),
      draft.prospectId ? listQuoteProspects() : Promise.resolve([]),
    ]);
    const company =
      vendors.find((party) => party.id === draft.vendorId)?.name ||
      customers.find((party) => party.id === draft.customerId)?.name ||
      prospects.find((party) => party.id === draft.prospectId)?.name ||
      "";
    const party = originatorDisplay({ kind: draft.originatorKind, company, contact: draft.counterpartyName });
    return <QuoteDocument draft={draft} offers={detail.offers} party={party === "—" ? "" : party} />;
  } catch (error) {
    return (
      <main className="page so-page ds">
        <p className="banner error" role="alert">
          {errorText(error)}
        </p>
        <p className="muted">
          <Link href={`${QUOTE_REVIEWS_PATH}/${id}`}>Back to quote request</Link>
        </p>
      </main>
    );
  }
}
