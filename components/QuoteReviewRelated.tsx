"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { errorText } from "@/lib/errors";
import { createRelatedQuoteReview, linkQuoteReviews, unlinkQuoteReview } from "@/lib/quoteReviewsServer";
import {
  QUOTE_CHANNELS,
  QUOTE_DIRECTIONS,
  QUOTE_RELATIONS,
  QUOTE_REVIEWS_PATH,
  isQuoteChannel,
  isQuoteDirection,
  quoteCalendarDay,
  suggestedRelatedDirection,
  suggestedRelationType,
  type QuoteChoice,
  type QuoteRelationView,
  type QuoteVendorOption,
} from "@/lib/quoteReviews";

export function QuoteReviewRelated({
  eventId,
  canEdit,
  currency,
  sourceDirection,
  sourceChannel,
  sourceReference,
  vendors,
  relations,
  choices,
}: {
  eventId: string;
  canEdit: boolean;
  currency: string;
  sourceDirection: string;
  sourceChannel: string;
  sourceReference: string;
  vendors: QuoteVendorOption[];
  relations: QuoteRelationView[];
  choices: QuoteChoice[];
}) {
  const router = useRouter();
  const direction = isQuoteDirection(sourceDirection) ? suggestedRelatedDirection(sourceDirection) : "outbound_ask";
  const [related, setRelated] = useState<{
    reference: string;
    counterpartyName: string;
    vendorId: string;
    channel: string;
    direction: string;
    receivedOn: string;
    dueOn: string;
    relationType: string;
    relationNote: string;
  }>({
    reference: sourceReference,
    counterpartyName: "",
    vendorId: "",
    channel: isQuoteChannel(sourceChannel) ? sourceChannel : "other",
    direction,
    receivedOn: quoteCalendarDay(),
    dueOn: "",
    relationType: suggestedRelationType(direction),
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

  function setDirection(next: string) {
    if (!isQuoteDirection(next)) return;
    setRelated((current) => ({
      ...current,
      direction: next,
      relationType: relationTouched ? current.relationType : suggestedRelationType(next),
    }));
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
        One link joins two events, in either direction. The label is stored from this quote toward the other one when you
        link them here.
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
              Copies the saved lines: SKU, name, part number, item, condition, and quantity. Our price, the decision, and
              competing bids stay blank. Currency stays {currency}. Save this quote first if the lines on screen are newer
              than the saved copy.
            </p>
            <div className="qr-head">
              <label>
                List name
                <input value={related.reference} onChange={(event) => setRelated({ ...related, reference: event.target.value })} />
              </label>
              <label>
                Direction
                <select value={related.direction} onChange={(event) => setDirection(event.target.value)}>
                  {QUOTE_DIRECTIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Channel
                <select value={related.channel} onChange={(event) => setRelated({ ...related, channel: event.target.value })}>
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
                  value={related.relationType}
                  onChange={(event) => {
                    setRelationTouched(true);
                    setRelated({ ...related, relationType: event.target.value });
                  }}
                >
                  {QUOTE_RELATIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Vendor
                <select
                  value={related.vendorId}
                  onChange={(event) => {
                    const vendorId = event.target.value;
                    const vendor = vendors.find((item) => item.id === vendorId);
                    setRelated((current) => ({
                      ...current,
                      vendorId,
                      counterpartyName: current.counterpartyName.trim() ? current.counterpartyName : vendor?.name ?? "",
                    }));
                  }}
                >
                  <option value="">No vendor</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Contact name
                <input
                  value={related.counterpartyName}
                  onChange={(event) => setRelated({ ...related, counterpartyName: event.target.value })}
                />
              </label>
              <label>
                Received
                <input
                  type="date"
                  value={related.receivedOn}
                  onChange={(event) => setRelated({ ...related, receivedOn: event.target.value })}
                  required
                />
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
                <input value={choiceQuery} onChange={(event) => setChoiceQuery(event.target.value)} placeholder="Name or direction" />
              </label>
              <label>
                Quote
                <select value={otherId} onChange={(event) => setOtherId(event.target.value)} required>
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
                <select value={linkType} onChange={(event) => setLinkType(event.target.value)}>
                  {QUOTE_RELATIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Note
                <input value={linkNote} onChange={(event) => setLinkNote(event.target.value)} />
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
