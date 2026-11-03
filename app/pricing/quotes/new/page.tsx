import { QuoteReviewForm } from "@/components/QuoteReviewForm";
import { errorText } from "@/lib/errors";
import { quoteReviewPageAccess } from "@/lib/quoteReviewSession";
import { listQuoteVendors } from "@/lib/quoteReviewsServer";
import { QUOTE_REVIEWS_PATH, blankQuoteDraft, quoteCalendarDay } from "@/lib/quoteReviews";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewQuoteReviewPage() {
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
  if (!access.canEdit) {
    return (
      <main className="page so-page ds">
        <p className="muted">You can view quote reviews. Creating and editing is limited to admin and staff.</p>
        <p>
          <Link href={QUOTE_REVIEWS_PATH}>Back to quote reviews</Link>
        </p>
      </main>
    );
  }
  let vendors: Awaited<ReturnType<typeof listQuoteVendors>> = [];
  let problem = "";
  try {
    vendors = await listQuoteVendors();
  } catch (error) {
    problem = errorText(error);
  }
  return (
    <main className="page so-page ds">
      {problem ? (
        <p className="banner error" role="alert">
          {problem}
        </p>
      ) : null}
      <QuoteReviewForm canEdit draft={blankQuoteDraft(quoteCalendarDay())} vendors={vendors} relations={[]} choices={[]} />
    </main>
  );
}
