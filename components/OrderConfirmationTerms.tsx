import { ORDER_CONFIRMATION_TERMS } from "@/lib/orderConfirmationTerms";

/** Second page of an order confirmation. Copy lives in `ORDER_CONFIRMATION_TERMS`. */
export function OrderConfirmationTerms({ orderRef }: { orderRef: string }) {
  const terms = ORDER_CONFIRMATION_TERMS;
  return (
    <article className="cust-doc cust-doc-terms-page" aria-label="Terms and conditions">
      <header className="cust-doc-terms-head">
        <p className="cust-doc-terms-draft">{terms.draftLabel}</p>
        <h1 className="cust-doc-terms-title">{terms.title}</h1>
        <p className="cust-doc-terms-seller">{terms.seller}</p>
        <p className="cust-doc-terms-ref">{orderRef}</p>
      </header>
      <div className="cust-doc-terms-columns">
        {terms.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
