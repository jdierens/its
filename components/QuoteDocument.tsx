import Link from "next/link";
import { LetterPrint } from "@/components/LetterPrint";
import { PrintDocumentButton } from "@/components/PrintDocumentButton";
import { CUSTOMER_DOCUMENT_COMPANY, CUSTOMER_DOCUMENT_LOGO } from "@/lib/customerDocument";
import { formatDataDate } from "@/lib/formatDate";
import { QUOTE_DOCUMENT_PRINT } from "@/lib/letterPrint";
import {
  quoteExportLines,
  quoteExportMoney,
  quoteExportQtyText,
  quoteExportTotals,
} from "@/lib/quoteExport";
import { QUOTE_REVIEWS_PATH, quoteFlowLabel, quoteMoneyText, type QuoteReviewDraft } from "@/lib/quoteReviews";

export function QuoteDocument({
  draft,
  party,
  exportedOn,
}: {
  draft: QuoteReviewDraft;
  party: string;
  exportedOn: string;
}) {
  const company = CUSTOMER_DOCUMENT_COMPANY;
  const currency = draft.currency || "USD";
  const rows = quoteExportLines(draft.lines);
  const totals = quoteExportTotals(rows);
  const due = draft.dueOn.trim();

  return (
    <main className="cust-doc-page ds">
      <LetterPrint
        orientation={QUOTE_DOCUMENT_PRINT.orientation}
        rootSelector={QUOTE_DOCUMENT_PRINT.rootSelector}
        fragmentSelector={QUOTE_DOCUMENT_PRINT.fragmentSelector}
      />
      <div className="cust-doc-tools no-print">
        <Link href={`${QUOTE_REVIEWS_PATH}/${draft.id}`}>Back to quote request</Link>
        <PrintDocumentButton />
      </div>
      <article className="cust-doc">
        <header className="cust-doc-top">
          <img className="cust-doc-logo" src={CUSTOMER_DOCUMENT_LOGO} alt="" />
          <div className="cust-doc-company">
            <p className="cust-doc-company-name">{company.name}</p>
            <p className="cust-doc-company-address">{company.address}</p>
          </div>
          <h1 className="cust-doc-title">QUOTE</h1>
        </header>
        <div className="cust-doc-ref">
          <span>REF</span>
          <strong>{draft.reference.trim() || "Quote"}</strong>
          <span className="cust-doc-ref-date">EXPORTED {formatDataDate(exportedOn)}</span>
        </div>
        <p className="quote-doc-who">
          {quoteFlowLabel(draft.side, draft.direction)}
          {party ? ` · ${party}` : ""}
        </p>
        <p className="quote-doc-who">
          Received {formatDataDate(draft.receivedOn) || "—"}
          {due ? ` · Due ${formatDataDate(due)}` : ""}
          {` · ${currency}`}
        </p>
        <table className="cust-doc-lines">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Qty</th>
              <th className="num">Bid unit</th>
              <th className="num">Bid ext</th>
              <th className="num">FMP unit</th>
              <th className="num">FMP ext</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.sku}-${row.name}-${index}`}>
                <td>{row.name || "—"}</td>
                <td className="num">{row.qty || "—"}</td>
                <td className="num">{quoteMoneyText(row.bidUnit, currency) || "—"}</td>
                <td className="num">{quoteExportMoney(row.bidExt, currency) || "—"}</td>
                <td className="num">{quoteMoneyText(row.fmpUnit, currency) || "—"}</td>
                <td className="num">{quoteExportMoney(row.fmpExt, currency) || "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{quoteExportQtyText(totals.qty) || "—"}</td>
              <td />
              <td className="num">{quoteExportMoney(totals.bidExt, currency) || "—"}</td>
              <td />
              <td className="num">{quoteExportMoney(totals.fmpExt, currency) || "—"}</td>
            </tr>
          </tfoot>
        </table>
      </article>
    </main>
  );
}
