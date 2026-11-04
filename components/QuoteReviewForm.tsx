"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { QuoteFlowMarks } from "@/components/QuoteFlowMarks";
import { QuoteOriginatorFields } from "@/components/QuoteOriginatorFields";
import { QuotePriceOverview } from "@/components/QuotePriceOverview";
import { QuoteReviewRelated } from "@/components/QuoteReviewRelated";
import { errorText } from "@/lib/errors";
import { formatMoney } from "@/lib/pricing/quotes";
import { saveQuoteReview, searchQuoteItems } from "@/lib/quoteReviewsServer";
import {
  QUOTE_CHANNELS,
  QUOTE_DECISIONS,
  QUOTE_DIRECTIONS,
  QUOTE_REVIEWS_PATH,
  QUOTE_SIDES,
  QUOTE_STATUSES,
  bestCompetingUnit,
  blankQuoteBid,
  blankQuoteLine,
  originatorForFlow,
  quoteBidderList,
  quoteBidders,
  quoteDirectionLabel,
  quoteFlowHint,
  quoteLeadTime,
  quoteReplyExtension,
  quoteSideLabel,
  type QuoteChoice,
  type QuoteItemHit,
  type QuoteLineDraft,
  type QuoteOfferColumn,
  type QuotePartyOption,
  type QuoteBidderListEntry,
  type QuoteRelationView,
  type QuoteReviewDraft,
} from "@/lib/quoteReviews";

type EditorLine = QuoteLineDraft & { hits: QuoteItemHit[]; findNote: string };

const LINE_COLUMNS = 14;

function toEditor(line: QuoteLineDraft): EditorLine {
  return { ...line, key: line.key || crypto.randomUUID(), hits: [], findNote: "" };
}

export function QuoteReviewForm({
  canEdit,
  draft,
  vendors,
  customers,
  prospects: initialProspects,
  relations,
  choices,
  offers = [],
}: {
  canEdit: boolean;
  draft: QuoteReviewDraft;
  vendors: QuotePartyOption[];
  customers: QuotePartyOption[];
  prospects: QuotePartyOption[];
  relations: QuoteRelationView[];
  choices: QuoteChoice[];
  offers?: QuoteOfferColumn[];
}) {
  const router = useRouter();
  const [header, setHeader] = useState(draft);
  const [prospects, setProspects] = useState(initialProspects);
  const [lines, setLines] = useState<EditorLine[]>(() => (draft.lines.length > 0 ? draft.lines.map(toEditor) : [toEditor(blankQuoteLine())]));
  const [bidderName, setBidderName] = useState("");
  const [selectedBidder, setSelectedBidder] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [finding, setFinding] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  const dueWarning =
    header.dueOn && header.receivedOn && header.dueOn < header.receivedOn
      ? "Due date is before the received date. You can still save."
      : "";
  const bidders = quoteBidders(lines);
  const bidderEntries = quoteBidderList(lines, relations);
  const activeBidder = selectedBidder && bidders.some((name) => name.toLowerCase() === selectedBidder.toLowerCase()) ? selectedBidder : null;

  function patchLine(key: string, patch: Partial<EditorLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function setFlow(patch: { side?: string; direction?: string }) {
    setHeader((current) => {
      const side = patch.side ?? current.side;
      const direction = patch.direction ?? current.direction;
      return { ...current, side, direction, ...originatorForFlow(side, direction, current) };
    });
  }

  function addBidder() {
    const name = bidderName.trim();
    if (!name) return;
    const existing = quoteBidders(lines).find((item) => item.toLowerCase() === name.toLowerCase());
    if (existing) {
      setSelectedBidder(existing);
      setBidderName("");
      return;
    }
    setLines((current) => {
      if (current.some((line) => line.bids.some((bid) => bid.bidderName.trim().toLowerCase() === name.toLowerCase()))) return current;
      const hosts = current.filter(lineHasRequest);
      const targets = hosts.length > 0 ? hosts : current.slice(0, 1);
      const keys = new Set(targets.map((line) => line.key));
      return current.map((line) =>
        keys.has(line.key) ? { ...line, bids: [...line.bids, { ...blankQuoteBid(name), key: crypto.randomUUID() }] } : line,
      );
    });
    setSelectedBidder(name);
    setBidderName("");
  }

  function removeBidder(name: string) {
    setLines((current) =>
      current.map((line) => ({
        ...line,
        bids: line.bids.filter((bid) => bid.bidderName.trim().toLowerCase() !== name.toLowerCase()),
      })),
    );
    setSelectedBidder(null);
  }

  function patchBidder(lineKey: string, name: string, patch: Partial<QuoteLineDraft["bids"][number]>) {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== lineKey) return line;
        const index = line.bids.findIndex((bid) => bid.bidderName.trim().toLowerCase() === name.toLowerCase());
        if (index < 0) return { ...line, bids: [...line.bids, { ...blankQuoteBid(name), key: crypto.randomUUID(), ...patch }] };
        return { ...line, bids: line.bids.map((bid, bidIndex) => (bidIndex === index ? { ...bid, ...patch } : bid)) };
      }),
    );
  }

  async function onFind(line: EditorLine) {
    const query = line.partNumber.trim() || line.sku.trim() || line.itemName.trim();
    if (!query) {
      patchLine(line.key, { findNote: "Enter a part, SKU, or name to find an item.", hits: [] });
      return;
    }
    setFinding(line.key);
    setProblem("");
    try {
      const hits = await searchQuoteItems(query);
      patchLine(line.key, { hits, findNote: hits.length === 0 ? "No item matched. The part can stay unmatched." : "" });
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setFinding(null);
    }
  }

  function pickHit(line: EditorLine, hit: QuoteItemHit) {
    patchLine(line.key, {
      itemId: hit.id,
      sku: hit.sku || line.sku,
      itemName: hit.name || line.itemName,
      partNumber: line.partNumber || hit.partNumber,
      condition: line.condition || hit.condition,
      onHand: hit.onHand,
      lastBuy: hit.lastBuy,
      lastSell: hit.lastSell,
      hits: [],
      findNote: "",
    });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setProblem("");
    setMessage("");
    setWarnings([]);
    try {
      const result = await saveQuoteReview(header.id, {
        reference: header.reference,
        counterpartyName: header.counterpartyName,
        vendorId: header.vendorId,
        customerId: header.customerId,
        prospectId: header.prospectId,
        originatorKind: header.originatorKind,
        channel: header.channel,
        direction: header.direction,
        side: header.side,
        status: header.status,
        receivedOn: header.receivedOn,
        dueOn: header.dueOn,
        currency: header.currency,
        notes: header.notes,
        lines: lines.map((line) => ({
          key: line.key,
          id: line.id,
          itemId: line.itemId,
          partNumber: line.partNumber,
          sku: line.sku,
          itemName: line.itemName,
          condition: line.condition,
          qty: line.qty,
          targetPrice: line.targetPrice,
          specialRequirements: line.specialRequirements,
          replyQty: line.replyQty,
          unitPrice: line.unitPrice,
          leadTime: line.leadTime,
          decision: line.decision,
          decisionNote: line.decisionNote,
          bids: line.bids.map((bid) => ({
            key: bid.key,
            id: bid.id,
            bidderName: bid.bidderName,
            unitPrice: bid.unitPrice,
            note: bid.note,
            sku: bid.sku,
            itemName: bid.itemName,
            qty: bid.qty,
            leadTime: bid.leadTime,
          })),
        })),
      });
      const next = result.lines.flatMap((saved) => {
        const current = lines.find((line) => line.key === saved.key);
        if (!current) return [];
        return [
          {
            ...current,
            id: saved.id,
            bids: current.bids
              .filter((bid) => bid.bidderName.trim() || bid.unitPrice.trim() || bid.note.trim() || bid.sku.trim() || bid.itemName.trim() || bid.qty.trim() || bid.leadTime.trim())
              .map((bid) => {
                const match = saved.bids.find((item) => item.key === bid.key);
                return match ? { ...bid, id: match.id } : bid;
              }),
          },
        ];
      });
      setLines(next.length > 0 ? next : [toEditor(blankQuoteLine())]);
      setWarnings(result.warnings);
      setMessage("Saved.");
      if (!header.id) {
        router.push(`${QUOTE_REVIEWS_PATH}/${result.id}`);
        return;
      }
      setHeader((current) => ({ ...current, id: result.id }));
      router.refresh();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  const companyHref = header.customerId ? `/customers/${header.customerId}` : header.vendorId ? `/vendors/${header.vendorId}` : "";
  const companyName = header.customerId
    ? customers.find((party) => party.id === header.customerId)?.name
    : header.vendorId
      ? vendors.find((party) => party.id === header.vendorId)?.name
      : prospects.find((party) => party.id === header.prospectId)?.name;

  return (
    <>
      <form onSubmit={onSave}>
        <p>
          <Link href={QUOTE_REVIEWS_PATH}>Back to quote reviews</Link>
        </p>
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
        {warnings.map((warning) => (
          <p className="banner warn" role="status" key={warning}>
            {warning}
          </p>
        ))}
        {!canEdit ? <p className="muted">You can view this quote. Editing is limited to admin and staff.</p> : null}
        <div className="card qr-related">
          <QuoteFlowMarks side={header.side} direction={header.direction} />
          <p className="hint">{quoteFlowHint(header.side, header.direction)}</p>
          <div className="qr-head qr-meta">
            <label>
              List name
              <input value={header.reference} disabled={!canEdit} onChange={(event) => setHeader({ ...header, reference: event.target.value })} />
            </label>
            <label>
              Side
              <select value={header.side} disabled={!canEdit} onChange={(event) => setFlow({ side: event.target.value })}>
                {QUOTE_SIDES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {quoteSideLabel(item.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Direction
              <select value={header.direction} disabled={!canEdit} onChange={(event) => setFlow({ direction: event.target.value })}>
                {QUOTE_DIRECTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {quoteDirectionLabel(item.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Channel
              <select value={header.channel} disabled={!canEdit} onChange={(event) => setHeader({ ...header, channel: event.target.value })}>
                {QUOTE_CHANNELS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={header.status} disabled={!canEdit} onChange={(event) => setHeader({ ...header, status: event.target.value })}>
                {QUOTE_STATUSES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <QuoteOriginatorFields
              side={header.side}
              direction={header.direction}
              originatorKind={header.originatorKind}
              vendorId={header.vendorId}
              customerId={header.customerId}
              prospectId={header.prospectId}
              contact={header.counterpartyName}
              disabled={!canEdit}
              vendors={vendors}
              customers={customers}
              prospects={prospects}
              onOriginator={(next) => setHeader((current) => ({ ...current, ...next }))}
              onContact={(counterpartyName) => setHeader((current) => ({ ...current, counterpartyName }))}
              onProspect={(prospect) => setProspects((current) => (current.some((item) => item.id === prospect.id) ? current : [...current, prospect].sort((a, b) => a.name.localeCompare(b.name))))}
            />
            <label>
              Received
              <input
                type="date"
                value={header.receivedOn}
                disabled={!canEdit}
                required
                onChange={(event) => setHeader({ ...header, receivedOn: event.target.value })}
              />
            </label>
            <label>
              Due
              <input type="date" value={header.dueOn} disabled={!canEdit} onChange={(event) => setHeader({ ...header, dueOn: event.target.value })} />
            </label>
            <label>
              Currency
              <input
                value={header.currency}
                disabled={!canEdit}
                maxLength={3}
                onChange={(event) => setHeader({ ...header, currency: event.target.value.toUpperCase() })}
              />
            </label>
            <label className="qr-notes">
              Notes
              <textarea rows={2} value={header.notes} disabled={!canEdit} onChange={(event) => setHeader({ ...header, notes: event.target.value })} />
            </label>
          </div>
          {dueWarning ? <p className="hint">{dueWarning}</p> : null}
          {companyName ? (
            <p className="hint">
              {header.originatorKind === "dds" ? "DDS → " : null}
              {companyHref ? <Link href={companyHref}>{companyName}</Link> : companyName}
              {header.counterpartyName.trim() && header.counterpartyName.trim().toLowerCase() !== companyName.toLowerCase()
                ? ` · ${header.counterpartyName.trim()}`
                : null}
              {header.prospectId ? " · Prospect" : null}
            </p>
          ) : null}
        </div>
        <QuotePriceOverview lines={lines} offers={offers} currency={header.currency || "USD"}>
          <BidderStrip
            canEdit={canEdit}
            entries={bidderEntries}
            bidderName={bidderName}
            activeBidder={activeBidder}
            lines={lines}
            onBidderName={setBidderName}
            onSelect={setSelectedBidder}
            onAdd={addBidder}
            onRemove={removeBidder}
            onPatch={patchBidder}
          />
        </QuotePriceOverview>
        <div className="card qr-lines">
          <div className="qr-line-bar">
            <h2>Line detail</h2>
            {canEdit ? (
              <button type="button" className="button secondary" onClick={() => setLines((current) => [...current, toEditor(blankQuoteLine())])}>
                Add line
              </button>
            ) : null}
          </div>
          <p className="hint">
            Request on the left. DDS unit on the right, with DDS ext under the unit. An empty lead time means in stock. Sheet and photo import is not on this page.
          </p>
          <div className="qr-scroll">
            <table>
              <thead>
                <tr className="qr-groups">
                  <th />
                  <th className="qr-request" colSpan={5}>
                    Request
                  </th>
                  <th className="qr-dds" colSpan={7}>
                    DDS response
                  </th>
                  <th />
                </tr>
                <tr>
                  <th>#</th>
                  <th>Part</th>
                  <th className="num">Qty</th>
                  <th className="num">Target</th>
                  <th>Condition</th>
                  <th>Requirements</th>
                  <th>SKU</th>
                  <th>Name</th>
                  <th className="num">Qty</th>
                  <th className="num">DDS unit</th>
                  <th>Lead time</th>
                  <th>Notes</th>
                  <th>Decision</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const best = bestCompetingUnit(line.bids);
                  return (
                    <LineRows
                      key={line.key}
                      line={line}
                      index={index}
                      canEdit={canEdit}
                      finding={finding === line.key}
                      best={best}
                      onPatch={(patch) => patchLine(line.key, patch)}
                      onFind={() => onFind(line)}
                      onPick={(hit) => pickHit(line, hit)}
                      onRemove={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        {canEdit ? (
          <p>
            <button className="button" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save quote"}
            </button>
          </p>
        ) : null}
      </form>
      {header.id ? (
        <QuoteReviewRelated
          eventId={header.id}
          canEdit={canEdit}
          currency={header.currency || "USD"}
          sourceSide={header.side}
          sourceDirection={header.direction}
          sourceChannel={header.channel}
          sourceReference={header.reference}
          vendors={vendors}
          customers={customers}
          prospects={prospects}
          onProspect={(prospect) => setProspects((current) => (current.some((item) => item.id === prospect.id) ? current : [...current, prospect]))}
          relations={relations}
          choices={choices}
        />
      ) : null}
      <section className="card qr-related">
        <h2>Files</h2>
        <p className="muted">
          Files are not stored on a quote review. Purchase orders and sales orders keep their own PDFs. Creating a purchase order or sales order from
          this quote is not built yet.
        </p>
      </section>
    </>
  );
}

function BidderStrip({
  canEdit,
  entries,
  bidderName,
  activeBidder,
  lines,
  onBidderName,
  onSelect,
  onAdd,
  onRemove,
  onPatch,
}: {
  canEdit: boolean;
  entries: QuoteBidderListEntry[];
  bidderName: string;
  activeBidder: string | null;
  lines: EditorLine[];
  onBidderName: (name: string) => void;
  onSelect: (name: string) => void;
  onAdd: () => void;
  onRemove: (name: string) => void;
  onPatch: (lineKey: string, name: string, patch: Partial<QuoteLineDraft["bids"][number]>) => void;
}) {
  return (
    <div className="qr-bidder-strip">
      <h3>Bidders</h3>
      {entries.length === 0 ? <p className="muted">No other responses yet.</p> : null}
      <div className="qr-bidders" role="list">
        {entries.map((entry, index) =>
          entry.kind === "bid" ? (
            <button
              key={`bid:${entry.name}`}
              type="button"
              className="button secondary qr-bidder"
              aria-pressed={activeBidder?.toLowerCase() === entry.name.toLowerCase()}
              onClick={() => onSelect(entry.name)}
            >
              {index + 1}. {entry.name}
            </button>
          ) : (
            <Link key={`related:${entry.id}`} href={`${QUOTE_REVIEWS_PATH}/${entry.otherId}`} className="button secondary qr-bidder">
              {index + 1}. {entry.label}
              {entry.phrase ? ` · ${entry.phrase}` : ""}
            </Link>
          ),
        )}
      </div>
      {canEdit ? (
        <div className="qr-bid">
          <input aria-label="New bidder" placeholder="Bidder" value={bidderName} onChange={(event) => onBidderName(event.target.value)} />
          <button type="button" className="button secondary" onClick={onAdd}>
            Add bidder
          </button>
        </div>
      ) : null}
      {activeBidder ? (
        <div className="qr-bidder-detail">
          <div className="qr-line-bar">
            <h3>{activeBidder}</h3>
            {canEdit ? (
              <button type="button" className="button secondary" onClick={() => onRemove(activeBidder)}>
                Remove bidder
              </button>
            ) : null}
          </div>
          <p className="hint">This party’s reply. DDS unit and DDS ext stay on the DDS column. An empty lead time means in stock.</p>
          <div className="qr-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Part</th>
                  <th>SKU</th>
                  <th>Name</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit</th>
                  <th>Lead time</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const bid = line.bids.find((item) => item.bidderName.trim().toLowerCase() === activeBidder.toLowerCase());
                  return (
                    <tr key={line.key}>
                      <td className="num">{index + 1}</td>
                      <td>{line.partNumber || "—"}</td>
                      <td>
                        <input
                          aria-label={`${activeBidder} SKU on line ${index + 1}`}
                          value={bid?.sku ?? ""}
                          disabled={!canEdit}
                          placeholder={line.sku}
                          onChange={(event) => onPatch(line.key, activeBidder, { sku: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${activeBidder} name on line ${index + 1}`}
                          value={bid?.itemName ?? ""}
                          disabled={!canEdit}
                          placeholder={line.itemName}
                          onChange={(event) => onPatch(line.key, activeBidder, { itemName: event.target.value })}
                        />
                      </td>
                      <td className="num">
                        <input
                          className="num"
                          inputMode="decimal"
                          aria-label={`${activeBidder} quantity on line ${index + 1}`}
                          value={bid?.qty ?? ""}
                          disabled={!canEdit}
                          placeholder={line.qty}
                          onChange={(event) => onPatch(line.key, activeBidder, { qty: event.target.value })}
                        />
                      </td>
                      <td className="num">
                        <input
                          className="num"
                          inputMode="decimal"
                          aria-label={`${activeBidder} unit price on line ${index + 1}`}
                          value={bid?.unitPrice ?? ""}
                          disabled={!canEdit}
                          onChange={(event) => onPatch(line.key, activeBidder, { unitPrice: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${activeBidder} lead time on line ${index + 1}`}
                          value={bid?.leadTime ?? ""}
                          disabled={!canEdit}
                          placeholder={quoteLeadTime("")}
                          onChange={(event) => onPatch(line.key, activeBidder, { leadTime: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${activeBidder} note on line ${index + 1}`}
                          value={bid?.note ?? ""}
                          disabled={!canEdit}
                          onChange={(event) => onPatch(line.key, activeBidder, { note: event.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function lineHasRequest(line: QuoteLineDraft): boolean {
  return Boolean(
    line.partNumber.trim() ||
      line.sku.trim() ||
      line.itemName.trim() ||
      line.qty.trim() ||
      line.targetPrice.trim() ||
      line.specialRequirements.trim() ||
      line.itemId,
  );
}

function LineRows({
  line,
  index,
  canEdit,
  finding,
  best,
  onPatch,
  onFind,
  onPick,
  onRemove,
}: {
  line: EditorLine;
  index: number;
  canEdit: boolean;
  finding: boolean;
  best: number | null;
  onPatch: (patch: Partial<EditorLine>) => void;
  onFind: () => void;
  onPick: (hit: QuoteItemHit) => void;
  onRemove: () => void;
}) {
  const number = index + 1;
  const ddsExt = quoteReplyExtension(line.qty, line.replyQty, line.unitPrice);
  return (
    <>
      <tr>
        <td className="num" data-label="#">
          {number}
        </td>
        <td data-label="Part">
          <input aria-label={`Part for line ${number}`} value={line.partNumber} disabled={!canEdit} onChange={(event) => onPatch({ partNumber: event.target.value })} />
        </td>
        <td className="num" data-label="Request qty">
          <input className="num" inputMode="decimal" aria-label={`Request quantity for line ${number}`} value={line.qty} disabled={!canEdit} onChange={(event) => onPatch({ qty: event.target.value })} />
        </td>
        <td className="num" data-label="Target">
          <input className="num" inputMode="decimal" aria-label={`Target price for line ${number}`} value={line.targetPrice} disabled={!canEdit} onChange={(event) => onPatch({ targetPrice: event.target.value })} />
        </td>
        <td data-label="Condition">
          <input aria-label={`Condition for line ${number}`} value={line.condition} disabled={!canEdit} onChange={(event) => onPatch({ condition: event.target.value })} />
        </td>
        <td data-label="Requirements">
          <input aria-label={`Special requirements for line ${number}`} value={line.specialRequirements} disabled={!canEdit} onChange={(event) => onPatch({ specialRequirements: event.target.value })} />
        </td>
        <td data-label="SKU">
          <input aria-label={`SKU for line ${number}`} value={line.sku} disabled={!canEdit} onChange={(event) => onPatch({ sku: event.target.value })} />
          {line.itemId ? <Link href={`/items/${line.itemId}`}>{line.sku || "Item"}</Link> : null}
        </td>
        <td data-label="Name">
          <input aria-label={`Name for line ${number}`} value={line.itemName} disabled={!canEdit} onChange={(event) => onPatch({ itemName: event.target.value })} />
        </td>
        <td className="num" data-label="Reply qty">
          <input className="num" inputMode="decimal" aria-label={`Reply quantity for line ${number}`} placeholder={line.qty} value={line.replyQty} disabled={!canEdit} onChange={(event) => onPatch({ replyQty: event.target.value })} />
        </td>
        <td className="num" data-label="DDS unit">
          <input className="num" inputMode="decimal" aria-label={`DDS unit for line ${number}`} value={line.unitPrice} disabled={!canEdit} onChange={(event) => onPatch({ unitPrice: event.target.value })} />
          {ddsExt ? (
            <span className="qr-context">
              <span className="sr-only">DDS ext </span>
              {ddsExt}
            </span>
          ) : null}
          {best != null ? <span className="qr-context">Best {formatMoney(best)}</span> : null}
        </td>
        <td data-label="Lead time">
          <input aria-label={`Lead time for line ${number}`} placeholder={quoteLeadTime("")} value={line.leadTime} disabled={!canEdit} onChange={(event) => onPatch({ leadTime: event.target.value })} />
        </td>
        <td data-label="Notes">
          <input aria-label={`Notes for line ${number}`} value={line.decisionNote} disabled={!canEdit} onChange={(event) => onPatch({ decisionNote: event.target.value })} />
        </td>
        <td data-label="Decision">
          <select aria-label={`Decision for line ${number}`} value={line.decision} disabled={!canEdit} onChange={(event) => onPatch({ decision: event.target.value })}>
            <option value="">—</option>
            {QUOTE_DECISIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </td>
        <td data-label="">
          {canEdit ? (
            <button type="button" className="button secondary" onClick={onRemove}>
              Remove
            </button>
          ) : null}
        </td>
      </tr>
      <tr>
        <td colSpan={LINE_COLUMNS} data-label="">
          <div className="qr-side">
            {line.itemId ? (
              <p className="qr-context">
                On hand {line.onHand ?? "—"}. Last buy {line.lastBuy || "—"}. Last sell {line.lastSell || "—"}.
                {canEdit ? (
                  <button type="button" className="button secondary" onClick={() => onPatch({ itemId: "", onHand: null, lastBuy: "", lastSell: "" })}>
                    Unmatch
                  </button>
                ) : null}
              </p>
            ) : line.partNumber.trim() || line.sku.trim() ? (
              <p className="qr-context">Unmatched part.</p>
            ) : null}
            {canEdit ? (
              <button type="button" className="button secondary" disabled={finding} onClick={onFind}>
                {finding ? "Finding…" : "Find item"}
              </button>
            ) : null}
            {line.findNote ? <p className="hint">{line.findNote}</p> : null}
            {line.hits.length > 0 ? (
              <ul className="qr-hits">
                {line.hits.map((hit) => (
                  <li key={hit.id}>
                    <button type="button" onClick={() => onPick(hit)}>
                      {hit.sku || hit.partNumber || "Item"} · {hit.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </td>
      </tr>
    </>
  );
}
