"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { QuoteFitInput } from "@/components/QuoteFitInput";
import { QuoteOriginatorFields } from "@/components/QuoteOriginatorFields";
import { errorText } from "@/lib/errors";
import { createRelatedQuoteReview, linkQuoteReviews, unlinkQuoteReview } from "@/lib/quoteReviewsServer";
import {
  QUOTE_CHANNELS,
  QUOTE_DIRECTIONS,
  QUOTE_RELATIONS,
  QUOTE_REVIEWS_PATH,
  QUOTE_SIDES,
  isQuoteChannel,
  isQuoteDirection,
  isQuoteRelationType,
  isQuoteSide,
  originatorForFlow,
  quoteCalendarDay,
  quoteDirectionLabel,
  quoteFlowLabel,
  quoteSideLabel,
  relationForNewFlow,
  suggestedRelatedFlow,
  type OriginatorIds,
  type QuoteChannel,
  type QuoteChoice,
  type QuoteDirection,
  type QuotePartyOption,
  type QuoteRelationType,
  type QuoteRelationView,
  type QuoteSide,
} from "@/lib/quoteReviews";

type RelatedQuoteDraft = {
  reference: string;
  counterpartyName: string;
  vendorId: string;
  customerId: string;
  prospectId: string;
  originatorKind: string;
  channel: QuoteChannel;
  direction: QuoteDirection;
  side: QuoteSide;
  receivedOn: string;
  dueOn: string;
  relationType: QuoteRelationType;
  relationNote: string;
};

export function QuoteReviewRelated({
  eventId,
  canEdit,
  currency,
  sourceSide,
  sourceDirection,
  sourceChannel,
  sourceReference,
  vendors,
  customers,
  prospects,
  onProspect,
  relations,
  choices,
}: {
  eventId: string;
  canEdit: boolean;
  currency: string;
  sourceSide: string;
  sourceDirection: string;
  sourceChannel: string;
  sourceReference: string;
  vendors: QuotePartyOption[];
  customers: QuotePartyOption[];
  prospects: QuotePartyOption[];
  onProspect: (prospect: QuotePartyOption) => void;
  relations: QuoteRelationView[];
  choices: QuoteChoice[];
}) {
  const router = useRouter();
  const suggested =
    isQuoteSide(sourceSide) && isQuoteDirection(sourceDirection)
      ? suggestedRelatedFlow(sourceSide, sourceDirection)
      : { side: "sell" as const, direction: "outbound" as const, relationType: "response_to" as const };
  const [related, setRelated] = useState<RelatedQuoteDraft>({
    reference: sourceReference,
    counterpartyName: "",
    vendorId: "",
    customerId: "",
    prospectId: "",
    originatorKind: suggested.direction === "outbound" ? "dds" : suggested.side === "buy" ? "vendor" : "customer",
    channel: isQuoteChannel(sourceChannel) ? sourceChannel : "other",
    direction: suggested.direction,
    side: suggested.side,
    receivedOn: quoteCalendarDay(),
    dueOn: "",
    relationType: suggested.relationType,
    relationNote: "",
  });
  const [relationTouched, setRelationTouched] = useState(false);
  const [otherId, setOtherId] = useState("");
  const [linkType, setLinkType] = useState("same_list");
  const [linkNote, setLinkNote] = useState("");
  const [choiceQuery, setChoiceQuery] = useState("");
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [pending, setPending] = useState(false);
  const linked = new Set(relations.map((relation) => relation.otherId));
  const needle = choiceQuery.trim().toLowerCase();
  const available = choices.filter((choice) => !linked.has(choice.id) && (!needle || choice.label.toLowerCase().includes(needle)));

  function setFlow(patch: { side?: string; direction?: string }) {
    setRelated((current) => {
      const side: QuoteSide = patch.side !== undefined && isQuoteSide(patch.side) ? patch.side : current.side;
      const direction: QuoteDirection =
        patch.direction !== undefined && isQuoteDirection(patch.direction) ? patch.direction : current.direction;
      return {
        ...current,
        side,
        direction,
        ...originatorForFlow(side, direction, current),
        relationType: relationTouched ? current.relationType : relationForNewFlow(side, direction),
      };
    });
  }

  function setOriginator(next: OriginatorIds) {
    setRelated((current) => ({ ...current, ...next }));
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setProblem("");
    setMessage("");
    setPending(true);
    try {
      const created = await createRelatedQuoteReview({ sourceId: eventId, ...related });
      router.push(`${QUOTE_REVIEWS_PATH}/${created.id}`);
    } catch (error) {
      setProblem(errorText(error));
      setPending(false);
    }
  }

  async function onLink(event: FormEvent) {
    event.preventDefault();
    setProblem("");
    setMessage("");
    setPending(true);
    try {
      await linkQuoteReviews(eventId, otherId, linkType, linkNote);
      setMessage("Linked.");
      setOtherId("");
      setLinkNote("");
      router.refresh();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setPending(false);
    }
  }

  async function onUnlink(relationId: string) {
    setProblem("");
    setMessage("");
    setPending(true);
    try {
      await unlinkQuoteReview(eventId, relationId);
      setMessage("Unlinked.");
      router.refresh();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card qr-related">
      <h2>Related quotes</h2>
      <p className="hint">
        One link joins two events. A related quote keeps the part, SKU, name, condition, quantity, target, and special requirements. Price, lead
        time, the decision, and bids stay on this quote.{" "}
        {isQuoteSide(sourceSide) && isQuoteDirection(sourceDirection) ? `This quote is ${quoteFlowLabel(sourceSide, sourceDirection)}.` : null}
      </p>
      {relations.length === 0 ? <p className="muted">No related quotes yet.</p> : null}
      {relations.length > 0 ? (
        <ul className="qr-links">
          {relations.map((relation) => (
            <li key={relation.id}>
              <Link href={`${QUOTE_REVIEWS_PATH}/${relation.otherId}`}>{relation.otherLabel}</Link>
              <span className="qr-chip">{relation.phrase}</span>
              {relation.note ? <span className="hint">{relation.note}</span> : null}
              {canEdit ? (
                <button type="button" className="button secondary" disabled={pending} onClick={() => onUnlink(relation.id)}>
                  Unlink
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <p className="banner error" role="alert">
          {problem}
        </p>
      ) : null}
      {message ? (
        <p className="banner ok" role="status">
          {message}
        </p>
      ) : null}
      {canEdit ? (
        <>
          <form onSubmit={onCreate}>
            <h3>Create related quote</h3>
            <p className="hint">
              Copies the saved request lines. Currency stays {currency}. Save this quote first if the lines on screen are newer than the saved copy.
              An inbound buy suggests an outbound sell, the way the Hong Kong market prices sit beside Mainstream.
            </p>
            <div className="qr-head">
              <label>
                List name
                <QuoteFitInput floor={8} cap={32} value={related.reference} onChange={(event) => setRelated({ ...related, reference: event.target.value })} />
              </label>
              <label>
                Side
                <select className="qr-fit" value={related.side} onChange={(event) => setFlow({ side: event.target.value })}>
                  {QUOTE_SIDES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {quoteSideLabel(item.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Direction
                <select className="qr-fit" value={related.direction} onChange={(event) => setFlow({ direction: event.target.value })}>
                  {QUOTE_DIRECTIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {quoteDirectionLabel(item.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Channel
                <select
                  className="qr-fit"
                  value={related.channel}
                  onChange={(event) => {
                    const channel = event.target.value;
                    if (!isQuoteChannel(channel)) return;
                    setRelated({ ...related, channel });
                  }}
                >
                  {QUOTE_CHANNELS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Relation
                <select
                  className="qr-fit"
                  value={related.relationType}
                  onChange={(event) => {
                    const relationType = event.target.value;
                    if (!isQuoteRelationType(relationType)) return;
                    setRelationTouched(true);
                    setRelated({ ...related, relationType });
                  }}
                >
                  {QUOTE_RELATIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <QuoteOriginatorFields
                side={related.side}
                direction={related.direction}
                originatorKind={related.originatorKind}
                vendorId={related.vendorId}
                customerId={related.customerId}
                prospectId={related.prospectId}
                contact={related.counterpartyName}
                disabled={false}
                vendors={vendors}
                customers={customers}
                prospects={prospects}
                onOriginator={setOriginator}
                onContact={(counterpartyName) => setRelated((current) => ({ ...current, counterpartyName }))}
                onProspect={onProspect}
              />
              <label>
                Received
                <input type="date" value={related.receivedOn} onChange={(event) => setRelated({ ...related, receivedOn: event.target.value })} required />
              </label>
              <label>
                Due
                <input type="date" value={related.dueOn} onChange={(event) => setRelated({ ...related, dueOn: event.target.value })} />
              </label>
              <label className="qr-notes">
                Relation note
                <input value={related.relationNote} onChange={(event) => setRelated({ ...related, relationNote: event.target.value })} />
              </label>
            </div>
            <p>
              <button className="button" type="submit" disabled={pending}>
                Create related quote
              </button>
            </p>
          </form>
          <form onSubmit={onLink}>
            <h3>Link an existing quote</h3>
            <div className="qr-head">
              <label>
                Find
                <QuoteFitInput floor={12} cap={28} value={choiceQuery} onChange={(event) => setChoiceQuery(event.target.value)} placeholder="Name or type" />
              </label>
              <label>
                Quote
                <select className="qr-fit" value={otherId} onChange={(event) => setOtherId(event.target.value)} required>
                  <option value="">Choose</option>
                  {available.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                This quote is
                <select className="qr-fit" value={linkType} onChange={(event) => setLinkType(event.target.value)}>
                  {QUOTE_RELATIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Note
                <QuoteFitInput floor={8} cap={32} value={linkNote} onChange={(event) => setLinkNote(event.target.value)} />
              </label>
            </div>
            <p>
              <button className="button secondary" type="submit" disabled={pending || !otherId}>
                Link quote
              </button>
            </p>
          </form>
        </>
      ) : null}
    </section>
  );
}
