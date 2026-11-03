import { notFound } from "next/navigation";
import { QuoteReviewForm } from "@/components/QuoteReviewForm";
import { errorText } from "@/lib/errors";
import { quoteReviewPageAccess } from "@/lib/quoteReviewSession";
import { listQuoteReviewChoices, listQuoteVendors, loadQuoteReview } from "@/lib/quoteReviewsServer";
import { QUOTE_REVIEWS_SETUP } from "@/lib/quoteReviews";

export const dynamic = "force-dynamic";

export default async function QuoteReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await quoteReviewPageAccess();
  if (!access.canView) {
    return (
      <main className="page so-page ds">
        <p className="banner error" role="alert">
          You cannot view prices.
        </p>
      </main>
    );
  }
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
    const [vendors, choices] = await Promise.all([listQuoteVendors(), listQuoteReviewChoices(id)]);
    return (
      <main className="page so-page ds">
        <QuoteReviewForm
          canEdit={access.canEdit}
          draft={detail.draft}
          vendors={vendors}
          relations={detail.relations}
          choices={choices}
        />
      </main>
    );
  } catch (error) {
    return (
      <main className="page so-page ds">
        <p className="banner error" role="alert">
          {errorText(error)}
        </p>
      </main>
    );
  }
}
