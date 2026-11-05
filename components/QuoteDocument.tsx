import Link from "next/link";
import { LetterPrint } from "@/components/LetterPrint";
import { PrintDocumentButton } from "@/components/PrintDocumentButton";
import { CUSTOMER_DOCUMENT_COMPANY, CUSTOMER_DOCUMENT_LOGO } from "@/lib/customerDocument";
import { formatDataDate } from "@/lib/formatDate";
import { QUOTE_DOCUMENT_PRINT } from "@/lib/letterPrint";
import {
  QUOTE_REVIEWS_PATH,
  offerUnit,
  quoteBidders,
  quoteColumnCaption,
  quoteExtText,
  quoteExtTotal,
  quoteFlowLabel,
  quoteMoneyText,
  quoteOverviewExt,
  quotePrintNoteLine,
  quotePrintNotes,
  type QuoteLineDraft,
  type QuoteOfferColumn,
  type QuoteReviewDraft,
} from "@/lib/quoteReviews";

export function QuoteDocument({
  draft,
  offers,
  party,
}: {
  draft: QuoteReviewDraft;
  offers: QuoteOfferColumn[];
  party: string;
}) {
  const company = CUSTOMER_DOCUMENT_COMPANY;
  const currency = draft.currency || "USD";
  const visible = draft.lines.filter(
    (line) =>
      line.partNumber.trim() ||
      line.sku.trim() ||
      line.qty.trim() ||
      line.condition.trim() ||
      line.unitPrice.trim() ||
      line.fspUnit.trim() ||
      line.bids.some((bid) => bid.unitPrice.trim() || bid.bidderName.trim()),
  );
  const local = quoteBidders(visible);
  const used = new Set(local.map((name) => name.toLowerCase()));
  const related = offers.map((offer) => {
    const base = offer.label.trim() || "Related";
    let label = base;
    if (used.has(label.toLowerCase())) label = `${base} · related`;
    used.add(label.toLowerCase());
    return { ...offer, label };
  });
  const notes = quotePrintNotes({
    ddsColumnCode: draft.ddsColumnCode,
    ddsBidNote: draft.ddsBidNote,
    lines: visible,
  });
  const ddsHead = quoteColumnCaption(draft.ddsColumnCode, "DDS", "DDS");

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
          <span className="cust-doc-ref-date">DATE {formatDataDate(draft.receivedOn)}</span>
        </div>
        <p className="quote-doc-who">
          {quoteFlowLabel(draft.side, draft.direction)}
          {party ? ` · ${party}` : ""}
        </p>
        <table className="cust-doc-lines">
          <thead>
            <tr>
              <th>Part</th>
              <th>SKU</th>
              <th className="num">Qty</th>
              <th>Condition</th>
              <th className="num" title={ddsHead.caption ? ddsHead.title : undefined}>
                {ddsHead.label}
                {ddsHead.caption ? <span className="quote-doc-ext">{ddsHead.caption}</span> : null}
              </th>
              <th className="num" title="Forecasted sales price">
                FSP
              </th>
              {local.map((name) => {
                const code = codeFor(visible, name);
                const head = quoteColumnCaption(code, name);
                return (
                  <th className="num" key={name} title={head.caption ? head.title : undefined}>
                    {head.label}
                    {head.caption ? <span className="quote-doc-ext">{head.caption}</span> : null}
                  </th>
                );
              })}
              {related.map((column) => {
                const head = quoteColumnCaption(column.columnCode ?? "", column.label, column.title || column.label);
                return (
                  <th className="num" key={column.id} title={head.caption ? head.title : undefined}>
                    {head.label}
                    {head.caption ? <span className="quote-doc-ext">{head.caption}</span> : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => (
              <tr key={line.key || `${line.partNumber}-${line.sku}`}>
                <td>{line.partNumber || "—"}</td>
                <td>{line.sku || "—"}</td>
                <td className="num">{line.qty || "—"}</td>
                <td>{line.condition || "—"}</td>
                <MoneyCell currency={currency} line={line} unit={line.unitPrice} kind="dds" />
                <MoneyCell currency={currency} line={line} unit={line.fspUnit} kind="dds" />
                {local.map((name) => {
                  const bid = line.bids.find((item) => item.bidderName.trim().toLowerCase() === name.toLowerCase());
                  return <MoneyCell key={name} currency={currency} line={line} unit={bid?.unitPrice ?? ""} kind="bid" />;
                })}
                {related.map((column) => (
                  <MoneyCell key={column.id} currency={currency} line={line} unit={offerUnit(column, line.partNumber, line.sku)} kind="bid" />
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Total</td>
              <td className="num">
                {quoteExtTotal(
                  visible.map((line) => quoteOverviewExt(line, line.unitPrice, "dds")),
                  currency,
                ) || "—"}
              </td>
              <td className="num">
                {quoteExtTotal(
                  visible.map((line) => quoteOverviewExt(line, line.fspUnit, "dds")),
                  currency,
                ) || "—"}
              </td>
              {local.map((name) => (
                <td className="num" key={name}>
                  {quoteExtTotal(
                    visible.map((line) => {
                      const bid = line.bids.find((item) => item.bidderName.trim().toLowerCase() === name.toLowerCase());
                      return quoteOverviewExt(line, bid?.unitPrice ?? "", "bid");
                    }),
                    currency,
                  ) || "—"}
                </td>
              ))}
              {related.map((column) => (
                <td className="num" key={column.id}>
                  {quoteExtTotal(
                    visible.map((line) => quoteOverviewExt(line, offerUnit(column, line.partNumber, line.sku), "bid")),
                    currency,
                  ) || "—"}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
        {notes.length > 0 ? (
          <section className="quote-doc-notes">
            <h2>Bid notes</h2>
            {notes.map((note) => (
              <p key={`${note.code}-${note.name}`}>{quotePrintNoteLine(note)}</p>
            ))}
          </section>
        ) : null}
      </article>
    </main>
  );
}

function codeFor(lines: QuoteLineDraft[], name: string): string {
  return lines.flatMap((line) => line.bids).find((bid) => bid.bidderName.trim().toLowerCase() === name.toLowerCase())?.columnCode ?? "";
}

function MoneyCell({
  currency,
  line,
  unit,
  kind,
}: {
  currency: string;
  line: QuoteLineDraft;
  unit: string;
  kind: "dds" | "bid";
}) {
  const ext = quoteExtText(quoteOverviewExt(line, unit, kind), currency);
  return (
    <td className="num">
      {quoteMoneyText(unit, currency) || "—"}
      {ext ? <span className="quote-doc-ext">{ext}</span> : null}
    </td>
  );
}
