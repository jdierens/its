import Link from "next/link";
import { QuoteFlowMarks } from "@/components/QuoteFlowMarks";
import { Badge } from "@/components/ui/badge";
import { errorText } from "@/lib/errors";
import { formatDataDate } from "@/lib/formatDate";
import { formatMoney } from "@/lib/pricing/quotes";
import { quoteReviewPageAccess } from "@/lib/quoteReviewSession";
import { listQuoteReviews } from "@/lib/quoteReviewsServer";
import {
  QUOTE_DIRECTIONS,
  QUOTE_REVIEWS_PATH,
  QUOTE_REVIEWS_SETUP,
  QUOTE_SIDES,
  QUOTE_STATUSES,
  quoteChannelLabel,
  quoteDirectionLabel,
  quoteStatusLabel,
  quoteStatusTone,
  type QuoteListRow,
} from "@/lib/quoteReviews";

export const dynamic = "force-dynamic";

export default async function QuoteReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; due?: string; side?: string; direction?: string }>;
}) {
  const params = await searchParams;
  const q = params.q ?? "";
  const status = params.status ?? "";
  const due = params.due ?? "";
  const side = params.side ?? "";
  const direction = params.direction ?? "";
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

  let result: Awaited<ReturnType<typeof listQuoteReviews>> | null = null;
  let problem = "";
  try {
    result = await listQuoteReviews({ q, status, due, side, direction });
  } catch (error) {
    problem = errorText(error);
  }

  const filtering = Boolean(q.trim() || status || due === "soon" || side || direction);

  return (
    <main className="page so-page ds">
      <p className="page-note">
        The type is Inbound Buy Request, Inbound Sell Request, Outbound Sell Request, or Outbound Buy Offer. Buy wins as a purchase order. Sell wins as a sales order. Sheet and photo import is not on this page.
      </p>
      {access.canEdit ? (
        <p>
          <Link className="button" href={`${QUOTE_REVIEWS_PATH}/new`}>
            New quote review
          </Link>
        </p>
      ) : (
        <p className="muted">You can view quote reviews. Creating and editing is limited to admin and staff.</p>
      )}
      <form className="qr-filters" method="get">
        <label>
          Originator
          <input name="q" defaultValue={q} placeholder="Company, contact, or list name" />
        </label>
        <label>
          Status
          <select className="qr-fit" name="status" defaultValue={status}>
            <option value="">Any</option>
            {QUOTE_STATUSES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Side
          <select className="qr-fit" name="side" defaultValue={side}>
            <option value="">Any</option>
            {QUOTE_SIDES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Direction
          <select className="qr-fit" name="direction" defaultValue={direction}>
            <option value="">Any</option>
            {QUOTE_DIRECTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {quoteDirectionLabel(item.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="qr-check">
          <input type="checkbox" name="due" value="soon" defaultChecked={due === "soon"} />
          Due soon
        </label>
        <button className="button secondary" type="submit">
          Filter
        </button>
        {filtering ? <Link href={QUOTE_REVIEWS_PATH}>Clear</Link> : null}
      </form>
      {problem ? (
        <p className="banner error" role="alert">
          {problem}
        </p>
      ) : null}
      {result?.unavailable ? (
        <p className="banner warn" role="status">
          {QUOTE_REVIEWS_SETUP}
        </p>
      ) : null}
      {result && !result.unavailable && result.truncated ? (
        <p className="hint">Showing the latest 500 quotes. Narrow the filters to see an older list.</p>
      ) : null}
      {result && !result.unavailable && result.rows.length === 0 ? (
        <p className="muted">{filtering ? "No quote reviews match." : "No quote reviews yet."}</p>
      ) : null}
      {result && result.rows.length > 0 ? (
        <>
          <div className="card qr-list-scroll">
            <table>
              <thead>
                <tr>
                  <th>List</th>
                  <th>Received</th>
                  <th>Due</th>
                  <th>Type</th>
                  <th>Originator</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th className="num">Lines</th>
                  <th className="num">Qty</th>
                  <th className="num">DDS offer</th>
                  <th className="num">Best competing</th>
                  <th>Related</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`${QUOTE_REVIEWS_PATH}/${row.id}`}>{row.label}</Link>
                    </td>
                    <td>{formatDataDate(row.receivedOn)}</td>
                    <td className={row.dueSoon ? "qr-due-soon" : undefined}>{formatDataDate(row.dueOn) || "—"}</td>
                    <td>
                      <QuoteFlowMarks side={row.side} direction={row.direction} />
                    </td>
                    <td>
                      <OriginatorCell row={row} />
                    </td>
                    <td>{quoteChannelLabel(row.channel)}</td>
                    <td>
                      <Badge tone={quoteStatusTone(row.status)}>{quoteStatusLabel(row.status)}</Badge>
                    </td>
                    <td className="num">{row.lineCount}</td>
                    <td className="num">{row.qty ?? "—"}</td>
                    <td className="num">{formatMoney(row.offerExt, row.currency)}</td>
                    <td className="num">{formatMoney(row.competingExt, row.currency)}</td>
                    <td>
                      {row.related.length === 0 ? (
                        "—"
                      ) : (
                        <span className="qr-related-cell">
                          {row.related.slice(0, 3).map((relation) => (
                            <Link key={relation.id} href={`${QUOTE_REVIEWS_PATH}/${relation.eventId}`} title={relation.otherLabel}>
                              {relation.phrase}
                            </Link>
                          ))}
                          {row.related.length > 3 ? <span className="muted">+{row.related.length - 3}</span> : null}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="qr-cards">
            {result.rows.map((row) => (
              <li className="qr-card" key={row.id}>
                <Link href={`${QUOTE_REVIEWS_PATH}/${row.id}`}>{row.label}</Link>
                <dl>
                  <dt>Received</dt>
                  <dd>{formatDataDate(row.receivedOn)}</dd>
                  <dt>Due</dt>
                  <dd className={row.dueSoon ? "qr-due-soon" : undefined}>{formatDataDate(row.dueOn) || "—"}</dd>
                  <dt>Type</dt>
                  <dd>
                    <QuoteFlowMarks side={row.side} direction={row.direction} />
                  </dd>
                  <dt>Originator</dt>
                  <dd>
                    <OriginatorCell row={row} />
                  </dd>
                  <dt>Channel</dt>
                  <dd>{quoteChannelLabel(row.channel)}</dd>
                  <dt>Status</dt>
                  <dd>
                    <Badge tone={quoteStatusTone(row.status)}>{quoteStatusLabel(row.status)}</Badge>
                  </dd>
                  <dt>Lines</dt>
                  <dd>{row.lineCount}</dd>
                  <dt>Qty</dt>
                  <dd>{row.qty ?? "—"}</dd>
                  <dt>DDS offer</dt>
                  <dd>{formatMoney(row.offerExt, row.currency)}</dd>
                  <dt>Best competing</dt>
                  <dd>{formatMoney(row.competingExt, row.currency)}</dd>
                  <dt>Related</dt>
                  <dd>{row.related.length || "—"}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}

function OriginatorCell({ row }: { row: QuoteListRow }) {
  const company = row.company || (row.originatorKind === "dds" ? "DDS" : "—");
  const href = row.customerId ? `/customers/${row.customerId}` : row.vendorId ? `/vendors/${row.vendorId}` : "";
  const showContact = Boolean(row.contact && row.contact.toLowerCase() !== company.toLowerCase());
  return (
    <span className="qr-origin">
      {row.originatorKind === "dds" && row.company ? <span>DDS → </span> : null}
      {href ? <Link href={href}>{company}</Link> : company}
      {showContact ? <span className="qr-contact">{row.contact}</span> : null}
      {row.prospectId ? <Badge tone="neutral">Prospect</Badge> : null}
    </span>
  );
}
