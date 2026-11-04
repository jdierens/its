import {
  offerUnit,
  quoteBidders,
  quoteMoneyExt,
  quoteMoneyText,
  type QuoteLineDraft,
  type QuoteOfferColumn,
} from "@/lib/quoteReviews";

export function QuotePriceOverview({
  lines,
  offers,
  currency,
}: {
  lines: QuoteLineDraft[];
  offers: QuoteOfferColumn[];
  currency: string;
}) {
  const visible = lines.filter(
    (line) => line.partNumber.trim() || line.sku.trim() || line.qty.trim() || line.condition.trim() || line.unitPrice.trim() || line.bids.some((bid) => bid.unitPrice.trim() || bid.bidderName.trim()),
  );
  if (visible.length === 0) return null;
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
      <p className="hint">Every price on the list, side by side. Related quotes add their own columns.</p>
      <div className="qr-scroll">
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th>SKU</th>
              <th className="num">Qty</th>
              <th>Condition</th>
              <th className="num">DDS unit</th>
              <th className="num">DDS ext</th>
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
              const requestQty = line.qty.trim() || line.replyQty;
              const ddsExt = quoteMoneyExt(line.replyQty.trim() || line.qty, line.unitPrice, currency);
              return (
                <tr key={line.key || `${line.partNumber}-${line.sku}`}>
                  <td>{line.partNumber || "—"}</td>
                  <td>{line.sku || "—"}</td>
                  <td className="num">{line.qty || "—"}</td>
                  <td>{line.condition || "—"}</td>
                  <td className="num">{quoteMoneyText(line.unitPrice, currency) || "—"}</td>
                  <td className="num">{ddsExt || "—"}</td>
                  {local.map((name) => {
                    const bid = line.bids.find((item) => item.bidderName.trim().toLowerCase() === name.toLowerCase());
                    const unit = bid?.unitPrice ?? "";
                    const ext = quoteMoneyExt(requestQty, unit, currency);
                    return (
                      <td className="num" key={name}>
                        <span>{quoteMoneyText(unit, currency) || "—"}</span>
                        {ext ? <span className="qr-context">{ext}</span> : null}
                      </td>
                    );
                  })}
                  {related.map((column) => {
                    const unit = offerUnit(column, line.partNumber, line.sku);
                    const ext = quoteMoneyExt(requestQty, unit, currency);
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
        </table>
      </div>
    </div>
  );
}
