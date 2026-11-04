import type { ReactNode } from "react";
import {
  offerUnit,
  quoteBidders,
  quoteExtText,
  quoteExtTotal,
  quoteMoneyText,
  quoteOverviewExt,
  type QuoteLineDraft,
  type QuoteOfferColumn,
} from "@/lib/quoteReviews";

export function QuotePriceOverview({
  lines,
  offers,
  currency,
  children,
}: {
  lines: QuoteLineDraft[];
  offers: QuoteOfferColumn[];
  currency: string;
  children?: ReactNode;
}) {
  const visible = lines.filter(
    (line) => line.partNumber.trim() || line.sku.trim() || line.qty.trim() || line.condition.trim() || line.unitPrice.trim() || line.bids.some((bid) => bid.unitPrice.trim() || bid.bidderName.trim()),
  );
  if (visible.length === 0) {
    if (!children) return null;
    return <div className="card qr-lines qr-overview">{children}</div>;
  }
  const local = quoteBidders(visible);
  const used = new Set(local.map((name) => name.toLowerCase()));
  const related = offers.map((offer) => {
    const base = offer.label.trim() || "Related";
    let label = base;
    if (used.has(label.toLowerCase())) label = `${base} · related`;
    used.add(label.toLowerCase());
    return { ...offer, label };
  });

  return (
    <div className="card qr-lines qr-overview">
      <h2>Overview</h2>
      <p className="hint">Every price on the list, side by side. The extension sits under the unit. The total row sums those extensions. Related quotes add their own columns.</p>
      <div className="qr-scroll">
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th>SKU</th>
              <th className="num">Qty</th>
              <th>Condition</th>
              <th className="num">DDS unit</th>
              {local.map((name) => (
                <th className="num" key={name}>
                  {name}
                </th>
              ))}
              {related.map((column) => (
                <th className="num" key={column.id}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => {
              const ddsExt = quoteExtText(quoteOverviewExt(line, line.unitPrice, "dds"), currency);
              return (
                <tr key={line.key || `${line.partNumber}-${line.sku}`}>
                  <td>{line.partNumber || "—"}</td>
                  <td>{line.sku || "—"}</td>
                  <td className="num">{line.qty || "—"}</td>
                  <td>{line.condition || "—"}</td>
                  <td className="num">
                    <span>{quoteMoneyText(line.unitPrice, currency) || "—"}</span>
                    {ddsExt ? <span className="qr-context">{ddsExt}</span> : null}
                  </td>
                  {local.map((name) => {
                    const bid = line.bids.find((item) => item.bidderName.trim().toLowerCase() === name.toLowerCase());
                    const unit = bid?.unitPrice ?? "";
                    const ext = quoteExtText(quoteOverviewExt(line, unit, "bid"), currency);
                    return (
                      <td className="num" key={name}>
                        <span>{quoteMoneyText(unit, currency) || "—"}</span>
                        {ext ? <span className="qr-context">{ext}</span> : null}
                      </td>
                    );
                  })}
                  {related.map((column) => {
                    const unit = offerUnit(column, line.partNumber, line.sku);
                    const ext = quoteExtText(quoteOverviewExt(line, unit, "bid"), currency);
                    return (
                      <td className="num" key={column.id}>
                        <span>{quoteMoneyText(unit, currency) || "—"}</span>
                        {ext ? <span className="qr-context">{ext}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} data-label="">
                Total
              </td>
              <td className="num" data-label="DDS">
                {quoteExtTotal(
                  visible.map((line) => quoteOverviewExt(line, line.unitPrice, "dds")),
                  currency,
                ) || "—"}
              </td>
              {local.map((name) => (
                <td className="num" data-label={name} key={name}>
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
                <td className="num" data-label={column.label} key={column.id}>
                  {quoteExtTotal(
                    visible.map((line) => quoteOverviewExt(line, offerUnit(column, line.partNumber, line.sku), "bid")),
                    currency,
                  ) || "—"}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {children}
    </div>
  );
}
