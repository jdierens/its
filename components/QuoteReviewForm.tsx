"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { QuoteFitInput } from "@/components/QuoteFitInput";
import { QuoteFlowMarks } from "@/components/QuoteFlowMarks";
import { QuoteOriginatorFields } from "@/components/QuoteOriginatorFields";
import { QuotePriceOverview } from "@/components/QuotePriceOverview";
import { QuoteReviewRelated } from "@/components/QuoteReviewRelated";
import { errorText } from "@/lib/errors";
import { formatMoney } from "@/lib/pricing/quotes";
import { createQuoteOrderDraft, saveQuoteReview, searchQuoteItems, type QuoteOrderDraftResult } from "@/lib/quoteReviewsServer";
import {
  DDS_AWARD,
  QUOTE_CHANNELS,
  QUOTE_DECISIONS,
  QUOTE_DIRECTIONS,
  QUOTE_REVIEWS_PATH,
  QUOTE_SIDES,
  QUOTE_STATUSES,
  bestQuotedUnit,
  blankQuoteAlt,
  blankQuoteBid,
  blankQuoteLine,
  originatorForFlow,
  quoteBidderList,
  quoteBidders,
  quoteDirectionLabel,
  quoteFlowHint,
  quoteLeadTime,
  quoteMoneyExt,
  quoteReplyExtension,
  quoteSideLabel,
  type QuoteChoice,
  type QuoteItemHit,
  type QuoteAltDraft,
  type QuoteLineDraft,
  type QuoteOfferColumn,
  type QuoteOrderLink,
  type QuotePartyOption,
  type QuoteBidderListEntry,
  type QuoteRelationView,
  type QuoteReviewDraft,
} from "@/lib/quoteReviews";

type EditorAlt = QuoteAltDraft & { hits: QuoteItemHit[]; findNote: string };
type EditorLine = Omit<QuoteLineDraft, "alts"> & { alts: EditorAlt[]; hits: QuoteItemHit[]; findNote: string };

const LINE_COLUMNS = 14;

function toEditor(line: QuoteLineDraft): EditorLine {
  return {
    ...line,
    key: line.key || crypto.randomUUID(),
    hits: [],
    findNote: "",
    alts: (line.alts ?? []).map((alt) => ({ ...alt, key: alt.key || crypto.randomUUID(), hits: [], findNote: "" })),
  };
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
  order = null,
}: {
  canEdit: boolean;
  draft: QuoteReviewDraft;
  vendors: QuotePartyOption[];
  customers: QuotePartyOption[];
  prospects: QuotePartyOption[];
  relations: QuoteRelationView[];
  choices: QuoteChoice[];
  offers?: QuoteOfferColumn[];
  order?: QuoteOrderLink | null;
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
  const [orderLink, setOrderLink] = useState<QuoteOrderLink | null>(order);
  const [awarding, setAwarding] = useState(false);

  useEffect(() => {
    setOrderLink(order);
  }, [order]);
  const dueWarning =
    header.dueOn && header.receivedOn && header.dueOn < header.receivedOn
      ? "Due date is before the received date. You can still save."
      : "";
  const bidders = quoteBidders(lines);
  const bidderEntries = quoteBidderList(lines, relations);
  const activeBidder = selectedBidder && bidders.some((name) => name.toLowerCase() === selectedBidder.toLowerCase()) ? selectedBidder : null;

  function patchLine(key: string, patch: Partial<EditorLine> | ((line: EditorLine) => Partial<EditorLine>)) {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next = typeof patch === "function" ? patch(line) : patch;
        return { ...line, ...next };
      }),
    );
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

  function quotePayload() {
    return {
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
        awardWinner: line.awardWinner,
        awardQty: line.awardQty,
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
        alts: line.alts.map((alt) => ({
          key: alt.key,
          id: alt.id,
          itemId: alt.itemId,
          partNumber: alt.partNumber,
          sku: alt.sku,
          itemName: alt.itemName,
          unitPrice: alt.unitPrice,
        })),
      })),
    };
  }

  function applySavedLines(saved: { key: string; id: string; bids: { key: string; id: string }[]; alts: { key: string; id: string }[] }[]) {
    const next = saved.flatMap((row) => {
      const current = lines.find((line) => line.key === row.key);
      if (!current) return [];
      return [
        {
          ...current,
          id: row.id,
          bids: current.bids
            .filter((bid) => bid.bidderName.trim() || bid.unitPrice.trim() || bid.note.trim() || bid.sku.trim() || bid.itemName.trim() || bid.qty.trim() || bid.leadTime.trim())
            .map((bid) => {
              const match = row.bids.find((item) => item.key === bid.key);
              return match ? { ...bid, id: match.id } : bid;
            }),
          alts: current.alts
            .filter((alt) => alt.itemId || alt.partNumber.trim() || alt.sku.trim() || alt.itemName.trim())
            .map((alt) => {
              const match = row.alts.find((item) => item.key === alt.key);
              return match ? { ...alt, id: match.id } : alt;
            }),
        },
      ];
    });
    setLines(next.length > 0 ? next : [toEditor(blankQuoteLine())]);
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setProblem("");
    setMessage("");
    setWarnings([]);
    try {
      const result = await saveQuoteReview(header.id, quotePayload());
      applySavedLines(result.lines);
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

  function awardAll() {
    setLines((current) =>
      current.map((line) => {
        if (!lineHasRequest(line)) return line;
        return {
          ...line,
          awardWinner: line.awardWinner || DDS_AWARD,
          awardQty: line.awardQty || line.replyQty || line.qty,
        };
      }),
    );
  }

  async function onAward() {
    if (!canEdit) return;
    setAwarding(true);
    setProblem("");
    setMessage("");
    setWarnings([]);
    try {
      const result = await saveQuoteReview(header.id, quotePayload());
      applySavedLines(result.lines);
      setWarnings(result.warnings);
      setHeader((current) => ({ ...current, id: result.id }));
      const drafted: QuoteOrderDraftResult = await createQuoteOrderDraft(result.id);
      setOrderLink(drafted);
      setMessage(drafted.message);
      if (drafted.created) setHeader((current) => ({ ...current, id: result.id, status: drafted.quoteStatus }));
      if (!header.id) {
        router.push(`${QUOTE_REVIEWS_PATH}/${result.id}`);
        return;
      }
      router.refresh();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setAwarding(false);
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
              <QuoteFitInput floor={8} cap={32} value={header.reference} disabled={!canEdit} onChange={(event) => setHeader({ ...header, reference: event.target.value })} />
            </label>
            <label>
              Side
              <select className="qr-fit" value={header.side} disabled={!canEdit} onChange={(event) => setFlow({ side: event.target.value })}>
                {QUOTE_SIDES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {quoteSideLabel(item.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Direction
              <select className="qr-fit" value={header.direction} disabled={!canEdit} onChange={(event) => setFlow({ direction: event.target.value })}>
                {QUOTE_DIRECTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {quoteDirectionLabel(item.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Channel
              <select className="qr-fit" value={header.channel} disabled={!canEdit} onChange={(event) => setHeader({ ...header, channel: event.target.value })}>
                {QUOTE_CHANNELS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select className="qr-fit" value={header.status} disabled={!canEdit} onChange={(event) => setHeader({ ...header, status: event.target.value })}>
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
              <QuoteFitInput
                floor={3}
                cap={4}
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
        <div className="card qr-lines qr-detail">
          <div className="qr-line-bar">
            <h2>Line detail</h2>
            {canEdit ? (
              <button type="button" className="button secondary" onClick={() => setLines((current) => [...current, toEditor(blankQuoteLine())])}>
                Add line
              </button>
            ) : null}
          </div>
          <p className="hint">
            Request on the left. The primary SKU is the DDS response. Alternatives are other SKUs for that same request. An empty lead time means in stock.
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
                  <th>Primary SKU</th>
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
                  const best = bestQuotedUnit(line, offers, header.side, header.direction);
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
        <div className="qr-line-bar">
          <h2>Award</h2>
          {canEdit ? (
            <button type="button" className="button secondary" disabled={saving || awarding} onClick={awardAll}>
              Award every line
            </button>
          ) : null}
        </div>
        <p className="hint">
          {header.side === "buy"
            ? "A won buy becomes a draft purchase order. It is not approved."
            : "A won sell becomes a draft sales order. It is not approved."}{" "}
          Check a line for a partial win. DDS is the response unless a bidder won that line.
        </p>
        {orderLink ? (
          <p>
            <Link href={orderLink.href}>{orderLink.label}</Link>
            {orderLink.status === "draft" ? " · draft" : ` · ${orderLink.status}`}
          </p>
        ) : null}
        <div className="qr-scroll">
          <table>
            <thead>
              <tr>
                <th>Award</th>
                <th>#</th>
                <th>Part</th>
                <th>Won by</th>
                <th className="num">Qty</th>
                <th className="num">Unit</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const winners = [{ id: DDS_AWARD, label: "DDS" }, ...line.bids.filter((bid) => bid.bidderName.trim()).map((bid) => ({ id: bid.bidderName, label: bid.bidderName }))];
                const winner = line.awardWinner.trim();
                const bid = line.bids.find((item) => item.bidderName.trim().toLowerCase() === winner.toLowerCase());
                const unit = winner.toLowerCase() === DDS_AWARD ? line.unitPrice : bid?.unitPrice ?? "";
                const qty = line.awardQty || line.replyQty || line.qty;
                return (
                  <tr key={line.key}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Award line ${index + 1}`}
                        checked={Boolean(winner)}
                        disabled={!canEdit}
                        onChange={(event) => {
                          if (!event.target.checked) {
                            patchLine(line.key, { awardWinner: "", awardQty: "" });
                            return;
                          }
                          patchLine(line.key, { awardWinner: winner || DDS_AWARD, awardQty: line.awardQty || line.replyQty || line.qty });
                        }}
                      />
                    </td>
                    <td className="num">{index + 1}</td>
                    <td>{line.partNumber || line.sku || "—"}</td>
                    <td>
                      <select
                        className="qr-fit"
                        aria-label={`Winner for line ${index + 1}`}
                        value={winner || DDS_AWARD}
                        disabled={!canEdit || !winner}
                        onChange={(event) => patchLine(line.key, { awardWinner: event.target.value })}
                      >
                        {winners.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      <QuoteFitInput
                        floor={3}
                        cap={8}
                        className="num"
                        inputMode="decimal"
                        aria-label={`Awarded quantity for line ${index + 1}`}
                        value={line.awardQty}
                        placeholder={line.replyQty || line.qty}
                        disabled={!canEdit || !winner}
                        onChange={(event) => patchLine(line.key, { awardQty: event.target.value })}
                      />
                    </td>
                    <td className="num">
                      {quoteMoneyExt(qty, unit, header.currency || "USD") ? (
                        <span>
                          {unit}
                          <span className="qr-context"> {quoteMoneyExt(qty, unit, header.currency || "USD")}</span>
                        </span>
                      ) : (
                        unit || "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canEdit ? (
          <p>
            <button type="button" className="button" disabled={saving || awarding} onClick={() => void onAward()}>
              {awarding ? "Creating…" : header.side === "buy" ? "Create draft purchase order" : "Create draft sales order"}
            </button>
          </p>
        ) : null}
      </section>
      <section className="card qr-related">
        <h2>Files</h2>
        <p className="muted">Files are not stored on a quote review. Purchase orders and sales orders keep their own PDFs.</p>
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
          <QuoteFitInput floor={6} cap={24} aria-label="New bidder" placeholder="Bidder" value={bidderName} onChange={(event) => onBidderName(event.target.value)} />
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
                        <QuoteFitInput
                          floor={7}
                          cap={20}
                          aria-label={`${activeBidder} SKU on line ${index + 1}`}
                          value={bid?.sku ?? ""}
                          disabled={!canEdit}
                          placeholder={line.sku}
                          onChange={(event) => onPatch(line.key, activeBidder, { sku: event.target.value })}
                        />
                      </td>
                      <td>
                        <QuoteFitInput
                          floor={10}
                          cap={36}
                          aria-label={`${activeBidder} name on line ${index + 1}`}
                          value={bid?.itemName ?? ""}
                          disabled={!canEdit}
                          placeholder={line.itemName}
                          onChange={(event) => onPatch(line.key, activeBidder, { itemName: event.target.value })}
                        />
                      </td>
                      <td className="num">
                        <QuoteFitInput
                          floor={3}
                          cap={8}
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
                        <QuoteFitInput
                          floor={5}
                          cap={12}
                          className="num"
                          inputMode="decimal"
                          aria-label={`${activeBidder} unit price on line ${index + 1}`}
                          value={bid?.unitPrice ?? ""}
                          disabled={!canEdit}
                          onChange={(event) => onPatch(line.key, activeBidder, { unitPrice: event.target.value })}
                        />
                      </td>
                      <td>
                        <QuoteFitInput
                          floor={8}
                          cap={18}
                          aria-label={`${activeBidder} lead time on line ${index + 1}`}
                          value={bid?.leadTime ?? ""}
                          disabled={!canEdit}
                          placeholder={quoteLeadTime("")}
                          onChange={(event) => onPatch(line.key, activeBidder, { leadTime: event.target.value })}
                        />
                      </td>
                      <td>
                        <QuoteFitInput
                          floor={8}
                          cap={32}
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
  onPatch: (patch: Partial<EditorLine> | ((line: EditorLine) => Partial<EditorLine>)) => void;
  onFind: () => void;
  onPick: (hit: QuoteItemHit) => void;
  onRemove: () => void;
}) {
  const number = index + 1;
  const ddsExt = quoteReplyExtension(line.qty, line.replyQty, line.unitPrice);
  const [findingAlt, setFindingAlt] = useState<string | null>(null);

  function patchAlt(key: string, patch: Partial<EditorAlt>) {
    onPatch((latest) => ({ alts: latest.alts.map((alt) => (alt.key === key ? { ...alt, ...patch } : alt)) }));
  }

  function pickAlt(key: string, hit: QuoteItemHit) {
    onPatch((latest) => ({
      alts: latest.alts.map((alt) =>
        alt.key === key
          ? {
              ...alt,
              itemId: hit.id,
              sku: hit.sku || alt.sku,
              itemName: hit.name || alt.itemName,
              partNumber: alt.partNumber || hit.partNumber,
              hits: [],
              findNote: "",
            }
          : alt,
      ),
    }));
  }

  async function findAlt(alt: EditorAlt) {
    const query = alt.sku.trim() || alt.partNumber.trim() || alt.itemName.trim();
    if (!query) {
      patchAlt(alt.key, { findNote: "Enter a SKU, part, or name to find an alternative.", hits: [] });
      return;
    }
    setFindingAlt(alt.key);
    try {
      const hits = await searchQuoteItems(query);
      patchAlt(alt.key, { hits, findNote: hits.length === 0 ? "No item matched. The alternative can stay unmatched." : "" });
    } catch (error) {
      patchAlt(alt.key, { findNote: errorText(error), hits: [] });
    } finally {
      setFindingAlt(null);
    }
  }

  return (
    <>
      <tr>
        <td className="num" data-label="#">
          {number}
        </td>
        <td data-label="Part">
          <QuoteFitInput floor={8} cap={28} aria-label={`Part for line ${number}`} value={line.partNumber} disabled={!canEdit} onChange={(event) => onPatch({ partNumber: event.target.value })} />
        </td>
        <td className="num" data-label="Request qty">
          <QuoteFitInput floor={3} cap={8} className="num" inputMode="decimal" aria-label={`Request quantity for line ${number}`} value={line.qty} disabled={!canEdit} onChange={(event) => onPatch({ qty: event.target.value })} />
        </td>
        <td className="num" data-label="Target">
          <QuoteFitInput floor={5} cap={12} className="num" inputMode="decimal" aria-label={`Target price for line ${number}`} value={line.targetPrice} disabled={!canEdit} onChange={(event) => onPatch({ targetPrice: event.target.value })} />
        </td>
        <td data-label="Condition">
          <QuoteFitInput floor={6} cap={16} aria-label={`Condition for line ${number}`} value={line.condition} disabled={!canEdit} onChange={(event) => onPatch({ condition: event.target.value })} />
        </td>
        <td data-label="Requirements">
          <QuoteFitInput floor={8} cap={32} aria-label={`Special requirements for line ${number}`} value={line.specialRequirements} disabled={!canEdit} onChange={(event) => onPatch({ specialRequirements: event.target.value })} />
        </td>
        <td data-label="Primary SKU">
          <QuoteFitInput floor={7} cap={20} aria-label={`Primary SKU for line ${number}`} value={line.sku} disabled={!canEdit} onChange={(event) => onPatch({ sku: event.target.value })} />
          {line.itemId ? <Link href={`/items/${line.itemId}`}>{line.sku || "Item"}</Link> : null}
        </td>
        <td data-label="Name">
          <QuoteFitInput floor={10} cap={36} aria-label={`Name for line ${number}`} value={line.itemName} disabled={!canEdit} onChange={(event) => onPatch({ itemName: event.target.value })} />
        </td>
        <td className="num" data-label="Reply qty">
          <QuoteFitInput floor={3} cap={8} className="num" inputMode="decimal" aria-label={`Reply quantity for line ${number}`} placeholder={line.qty} value={line.replyQty} disabled={!canEdit} onChange={(event) => onPatch({ replyQty: event.target.value })} />
        </td>
        <td className="num" data-label="DDS unit">
          <QuoteFitInput floor={5} cap={12} className="num" inputMode="decimal" aria-label={`DDS unit for line ${number}`} value={line.unitPrice} disabled={!canEdit} onChange={(event) => onPatch({ unitPrice: event.target.value })} />
          {ddsExt ? (
            <span className="qr-context">
              <span className="sr-only">DDS ext </span>
              {ddsExt}
            </span>
          ) : null}
          {best != null ? <span className="qr-context">Best {formatMoney(best)}</span> : null}
        </td>
        <td data-label="Lead time">
          <QuoteFitInput floor={8} cap={18} aria-label={`Lead time for line ${number}`} placeholder={quoteLeadTime("")} value={line.leadTime} disabled={!canEdit} onChange={(event) => onPatch({ leadTime: event.target.value })} />
        </td>
        <td data-label="Notes">
          <QuoteFitInput floor={8} cap={32} aria-label={`Notes for line ${number}`} value={line.decisionNote} disabled={!canEdit} onChange={(event) => onPatch({ decisionNote: event.target.value })} />
        </td>
        <td data-label="Decision">
          <select className="qr-fit" aria-label={`Decision for line ${number}`} value={line.decision} disabled={!canEdit} onChange={(event) => onPatch({ decision: event.target.value })}>
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
            <button type="button" className="secondary so-icon-remove" aria-label={`Remove line ${number}`} title="Remove" onClick={onRemove}>
              <Trash2 size={14} strokeWidth={1.75} aria-hidden />
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
            <div className="qr-alts">
              <p className="qr-context">Alternatives</p>
              {line.alts.map((alt, altIndex) => {
                const ext = quoteMoneyExt(line.replyQty || line.qty, alt.unitPrice);
                return (
                  <div key={alt.key || altIndex} className="qr-alt">
                    <QuoteFitInput
                      floor={7}
                      cap={20}
                      aria-label={`Alternative SKU ${altIndex + 1} for line ${number}`}
                      placeholder="SKU"
                      value={alt.sku}
                      disabled={!canEdit}
                      onChange={(event) => patchAlt(alt.key, { sku: event.target.value })}
                    />
                    <QuoteFitInput
                      floor={10}
                      cap={28}
                      aria-label={`Alternative name ${altIndex + 1} for line ${number}`}
                      placeholder="Name"
                      value={alt.itemName}
                      disabled={!canEdit}
                      onChange={(event) => patchAlt(alt.key, { itemName: event.target.value })}
                    />
                    <QuoteFitInput
                      floor={5}
                      cap={12}
                      className="num"
                      inputMode="decimal"
                      aria-label={`Alternative unit ${altIndex + 1} for line ${number}`}
                      placeholder="Unit"
                      value={alt.unitPrice}
                      disabled={!canEdit}
                      onChange={(event) => patchAlt(alt.key, { unitPrice: event.target.value })}
                    />
                    {ext ? <span className="qr-context">{ext}</span> : null}
                    {alt.itemId ? <Link href={`/items/${alt.itemId}`}>{alt.sku || "Item"}</Link> : null}
                    {canEdit ? (
                      <button type="button" className="button secondary" disabled={findingAlt === alt.key} onClick={() => void findAlt(alt)}>
                        {findingAlt === alt.key ? "Finding…" : "Find"}
                      </button>
                    ) : null}
                    {canEdit ? (
                      <button
                        type="button"
                        className="secondary so-icon-remove"
                        aria-label={`Remove alternative ${altIndex + 1} on line ${number}`}
                        title="Remove alternative"
                        onClick={() => onPatch({ alts: line.alts.filter((item) => item.key !== alt.key) })}
                      >
                        <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                      </button>
                    ) : null}
                    {alt.findNote ? <p className="hint">{alt.findNote}</p> : null}
                    {alt.hits.length > 0 ? (
                      <ul className="qr-hits">
                        {alt.hits.map((hit) => (
                          <li key={hit.id}>
                            <button type="button" onClick={() => pickAlt(alt.key, hit)}>
                              {hit.sku || hit.partNumber || "Item"} · {hit.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
              {canEdit ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onPatch({ alts: [...line.alts, { ...blankQuoteAlt(), key: crypto.randomUUID(), hits: [], findNote: "" }] })}
                >
                  Add alternative SKU
                </button>
              ) : null}
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}
