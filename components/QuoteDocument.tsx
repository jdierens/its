import Link from "next/link";
import { LetterPrint } from "@/components/LetterPrint";
import { PrintDocumentButton } from "@/components/PrintDocumentButton";
import { CUSTOMER_DOCUMENT_COMPANY, CUSTOMER_DOCUMENT_LOGO } from "@/lib/customerDocument";
import { formatDataDate } from "@/lib/formatDate";
import { QUOTE_DOCUMENT_PRINT } from "@/lib/letterPrint";
import {
  quoteExportDocument,
  quoteExportMoney,
  quoteExportPercent,
  quoteExportQtyText,
} from "@/lib/quoteExport";
import { QUOTE_REVIEWS_PATH, quoteFlowLabel, quoteMoneyText, quotePrintNoteLine, type QuoteReviewDraft } from "@/lib/quoteReviews";

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
  const sheet = quoteExportDocument(draft);
  const due = draft.dueOn.trim();

  return (
    <main className="cust-doc-page quote-doc-page ds">
      <LetterPrint
        orientation={QUOTE_DOCUMENT_PRINT.orientation}
        rootSelector={QUOTE_DOCUMENT_PRINT.rootSelector}
        fragmentSelector={QUOTE_DOCUMENT_PRINT.fragmentSelector}
      />
      <div className="cust-doc-tools no-print">
        <Link href={`${QUOTE_REVIEWS_PATH}/${draft.id}`}>Back to quote request</Link>
        <PrintDocumentButton />
      </div>
      <article className="cust-doc quote-doc">
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
              {sheet.columns.map((column) => (
                <th className="num" key={column.key} title={column.caption || undefined}>
                  {column.header}
                  {column.caption ? <span className="quote-doc-ext">{column.caption}</span> : null}
                </th>
              ))}
              {sheet.showProfit ? (
                <>
                  <th className="num">FGP$</th>
                  <th className="num">FGP%</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <td>{row.name || "—"}</td>
                <td className="num">{row.qty || "—"}</td>
                {row.prices.map((price, priceIndex) => {
                  const ext = quoteExportMoney(price.ext, currency);
                  return (
                    <td className="num" key={sheet.columns[priceIndex]?.key ?? priceIndex}>
                      {quoteMoneyText(price.unit, currency) || "—"}
                      {ext ? <span className="quote-doc-ext">{ext}</span> : null}
                    </td>
                  );
                })}
                {sheet.showProfit ? (
                  <>
                    <td className="num">{quoteExportMoney(row.fgpDollars, currency) || "—"}</td>
                    <td className="num">{quoteExportPercent(row.fgpRatio) || "—"}</td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{quoteExportQtyText(sheet.totals.qty) || "—"}</td>
              {sheet.totals.exts.map((amount, index) => (
                <td className="num" key={sheet.columns[index]?.key ?? index}>
                  {quoteExportMoney(amount, currency) || "—"}
                </td>
              ))}
              {sheet.showProfit ? (
                <>
                  <td className="num">{quoteExportMoney(sheet.totals.fgp.dollars, currency) || "—"}</td>
                  <td className="num">{quoteExportPercent(sheet.totals.fgp.ratio) || "—"}</td>
                </>
              ) : null}
            </tr>
          </tfoot>
        </table>
        {sheet.notes.length > 0 ? (
          <section className="quote-doc-notes">
            <h2>Bid notes</h2>
            {sheet.notes.map((note) => (
              <p key={`${note.code}-${note.name}`}>{quotePrintNoteLine(note)}</p>
            ))}
          </section>
        ) : null}
      </article>
    </main>
  );
}
