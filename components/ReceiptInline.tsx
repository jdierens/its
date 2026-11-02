"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { errorText } from "@/lib/errors";
import { descriptionSnippet } from "@/lib/labelLookup";
import { labelHighlightedChoice, labelSearchOutcome } from "@/lib/labelDeskSelection";
import {
  projectReceiptApplyDecision,
  projectReceiptApplySummary,
} from "@/lib/projectReceiptApply";
import { applyReceiptOwner, countOtherProjectReceipts, editReceipt, searchReceivingScan, setReceiptDamaged } from "@/lib/receivingActions";
import {
  planReceiptEdit,
  receiptBinReference,
  receiptLineAfterPick,
  skuFinderSeed,
  type ReceiptEditBody,
  type ReceiptPatch,
} from "@/lib/receiptInline";
import { commentWithStockStatus, receivePrepKind } from "@/lib/receivingLine";
import { scanSearchNote } from "@/lib/receivingScan";
import { RECEIVING_DATE_EDITABLE, formatReceivedOn, type ReceivingEntry } from "@/lib/receivingSettings";
import type { LabelItem } from "@/lib/types";

type Confirm = { summary: string; body: ReceiptEditBody };
type OwnerConfirm = {
  summary: string;
  field: "vendor" | "consignment";
  vendorId: string | null;
  consigned: boolean;
};
type Field = "date" | "project" | "incoming" | "origin" | "originQty" | "search" | "sku" | "qty" | "putaway" | "comment" | "vendor";
type VendorOption = { id: string; name: string };

function useReceiptEdit(entry: ReceivingEntry, onSaved: () => void, vendors: readonly VendorOption[]) {
  const [field, setField] = useState<Field | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [ownerConfirm, setOwnerConfirm] = useState<OwnerConfirm | null>(null);
  const [pendingItem, setPendingItem] = useState<ReceiptPatch["item"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const signature = [
    entry.receivedOn,
    entry.project,
    entry.incomingBin,
    entry.originatingSystem,
    entry.originQty,
    entry.sku,
    entry.itemId,
    entry.itemName,
    entry.qty,
    entry.comment,
    entry.searchQuery,
    entry.vendorId,
    entry.ownership,
    entry.cleaned,
    entry.wiped,
    entry.damaged,
    entry.shortCode,
    entry.putaway,
  ].join("\u0001");

  useEffect(() => {
    lock.current = false;
    setSaving(false);
    setField(null);
    setConfirm(null);
    setOwnerConfirm(null);
    setPendingItem(null);
    setError(null);
  }, [signature]);

  async function persist(body: ReceiptEditBody, confirmed: boolean) {
    setSaving(true);
    setError(null);
    try {
      await editReceipt({
        eventId: entry.id,
        receivedOn: body.receivedOn,
        project: body.project,
        incomingTag: body.incomingTag,
        origin: body.origin,
        originQty: body.originQty,
        comment: body.comment,
        qty: body.qty,
        itemId: body.itemId,
        confirmed,
        cleaned: body.cleaned,
        wiped: body.wiped,
        searchQuery: body.searchQuery,
        binReference: body.binReference,
      });
      setField(null);
      setConfirm(null);
      onSaved();
    } catch (cause) {
      lock.current = false;
      setSaving(false);
      setError(errorText(cause));
    }
  }

  function apply(patch: ReceiptPatch) {
    if (lock.current || saving) return;
    const plan = planReceiptEdit(entry, patch, false);
    if (plan.action === "unchanged") {
      setField(null);
      setError(null);
      return;
    }
    if (plan.action === "invalid") {
      setError(plan.message);
      return;
    }
    setError(null);
    setField(null);
    if (plan.action === "confirm") {
      setPendingItem(patch.item && patch.item.id !== entry.itemId ? patch.item : null);
      setConfirm({ summary: plan.summary, body: plan.body });
      return;
    }
    setPendingItem(null);
    lock.current = true;
    void persist(plan.body, false);
  }

  async function persistOwner(next: OwnerConfirm, applyToProject: boolean) {
    if (lock.current || saving) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      await applyReceiptOwner({
        eventId: entry.id,
        project: entry.project,
        field: next.field,
        vendorId: next.vendorId,
        consigned: next.consigned,
        applyToProject,
      });
      setField(null);
      setOwnerConfirm(null);
      onSaved();
    } catch (cause) {
      lock.current = false;
      setSaving(false);
      setError(errorText(cause));
    }
  }

  async function considerOwner(next: OwnerConfirm) {
    if (lock.current || saving) return;
    setError(null);
    setField(null);
    const project = (entry.project ?? "").trim();
    let others = 0;
    if (project) {
      try {
        others = await countOtherProjectReceipts(project, entry.id);
      } catch (cause) {
        setError(errorText(cause));
        return;
      }
    }
    if (projectReceiptApplyDecision({ project: entry.project, otherLineCount: others, changed: true }) === "prompt") {
      setOwnerConfirm(next);
      return;
    }
    await persistOwner(next, false);
  }

  async function commitVendor(vendorId: string) {
    const next = vendorId.trim();
    if (next === (entry.vendorId ?? "")) {
      setField(null);
      setError(null);
      return;
    }
    if (!next) {
      setError("Choose a vendor.");
      return;
    }
    const name = vendors.find((vendor) => vendor.id === next)?.name || entry.vendorName || "this vendor";
    await considerOwner({
      summary: projectReceiptApplySummary({ field: "vendor", project: entry.project ?? "", vendorName: name }),
      field: "vendor",
      vendorId: next,
      consigned: entry.ownership === "consigned",
    });
  }

  async function commitConsignment(next: boolean) {
    if (next === (entry.ownership === "consigned")) return;
    await considerOwner({
      summary: projectReceiptApplySummary({ field: "consignment", project: entry.project ?? "", consigned: next }),
      field: "consignment",
      vendorId: entry.vendorId,
      consigned: next,
    });
  }

  function confirmSave() {
    if (!confirm || lock.current || saving) return;
    lock.current = true;
    void persist(confirm.body, true);
  }

  async function toggleDamaged(next: boolean) {
    if (lock.current || saving || next === entry.damaged) return;
    const message = next
      ? "Mark this receipt damaged? That quantity leaves inventory for sale."
      : "Clear damaged on this receipt? That quantity becomes available for sale.";
    if (!window.confirm(message)) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      await setReceiptDamaged(entry.id, next);
      setField(null);
      setConfirm(null);
      onSaved();
    } catch (cause) {
      lock.current = false;
      setSaving(false);
      setError(errorText(cause));
    }
  }

  return {
    field,
    setField,
    confirm,
    ownerConfirm,
    pendingItem,
    error,
    saving,
    apply,
    confirmSave,
    commitVendor,
    commitConsignment,
    acceptOwner() {
      if (!ownerConfirm) return;
      void persistOwner(ownerConfirm, true);
    },
    declineOwner() {
      if (!ownerConfirm) return;
      void persistOwner(ownerConfirm, false);
    },
    toggleDamaged,
    cancelConfirm() {
      setPendingItem(null);
      setConfirm(null);
      setError(null);
    },
  };
}

function TextEdit({
  value,
  kind,
  align,
  onCommit,
  onCancel,
}: {
  value: string;
  kind: "text" | "date" | "number";
  align?: "right";
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const lock = useRef(false);
  function commit(next: string) {
    if (lock.current) return;
    lock.current = true;
    onCommit(next);
    window.setTimeout(() => {
      lock.current = false;
    }, 0);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      lock.current = true;
      onCancel();
    }
  }
  return (
    <input
      className={`cell-input receive-cell-input${align === "right" ? " num" : ""}`}
      autoFocus
      type={kind === "number" ? "text" : kind}
      inputMode={kind === "number" ? "numeric" : undefined}
      defaultValue={value}
      aria-label="Edit"
      onKeyDown={onKeyDown}
      onBlur={(event) => commit(event.currentTarget.value)}
    />
  );
}

function CellButton({
  value,
  placeholder,
  title,
  align,
  onClick,
  onMouseDown,
}: {
  value: string;
  placeholder?: string;
  title?: string;
  align?: "right";
  onClick: () => void;
  onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const empty = value.trim() === "";
  return (
    <button
      type="button"
      className={`receive-cell${align === "right" ? " num" : ""}${empty && placeholder ? " is-placeholder" : ""}`}
      title={title}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {empty ? placeholder || "\u00a0" : value}
    </button>
  );
}

function SkuEdit({
  entry,
  onPick,
  onCancel,
}: {
  entry: ReceivingEntry;
  onPick: (item: LabelItem) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState(() => skuFinderSeed(entry));
  const [matches, setMatches] = useState<LabelItem[]>([]);
  const [active, setActive] = useState(-1);
  const [settled, setSettled] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const openedAt = useRef(0);
  const refocuses = useRef(0);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    openedAt.current = performance.now();
    const node = inputRef.current;
    node?.focus();
    node?.select();
  }, []);

  useEffect(() => {
    const node = inputRef.current;
    if (!node || matches.length === 0) return;
    function place() {
      const rect = node?.getBoundingClientRect();
      if (!rect) return;
      setBox({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 280) });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [matches.length, query]);

  useEffect(() => {
    const text = query.trim();
    if (!text || text === entry.sku) {
      setMatches([]);
      setNote(null);
      return;
    }
    let cancelled = false;
    const id = ++request.current;
    const handle = window.setTimeout(() => {
      void searchReceivingScan(text)
        .then((result) => {
          if (cancelled || id !== request.current) return;
          const found = Boolean(result.exact || result.matches.length > 0);
          setNote(scanSearchNote({ token: result.token, tried: result.tried, found }));
          setSettled(text);
          const outcome = labelSearchOutcome({
            submitted: false,
            exact: result.exact,
            matches: result.matches,
            truncated: result.truncated,
          });
          if (outcome.type === "select" && outcome.item) {
            onPickRef.current(outcome.item);
            return;
          }
          if (outcome.type === "list") {
            setMatches(outcome.matches);
            setActive(outcome.matches.length > 0 ? 0 : -1);
            return;
          }
          setMatches([]);
          setActive(-1);
        })
        .catch(() => {
          if (!cancelled && id === request.current) setMatches([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [entry.sku, query]);

  function pickHighlighted() {
    const choice = labelHighlightedChoice({ identifier: query.trim(), settledQuery: settled, matches, active });
    if (choice) onPick(choice);
  }

  return (
    <>
      <input
        ref={inputRef}
        className="cell-input receive-cell-input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
        aria-label={`Find item, currently ${skuFinderSeed(entry) || "none"}`}
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => {
              if (matches.length === 0) return -1;
              if (event.key === "ArrowDown") return current < 0 ? 0 : Math.min(matches.length - 1, current + 1);
              return current < 0 ? matches.length - 1 : Math.max(0, current - 1);
            });
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            pickHighlighted();
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            const active = document.activeElement;
            if (active === inputRef.current) return;
            if (active?.closest?.(".receive-sku-menu")) return;
            const lostToPage = !active || active === document.body || active === document.documentElement;
            if (lostToPage && performance.now() - openedAt.current < 500 && refocuses.current < 2) {
              refocuses.current += 1;
              inputRef.current?.focus();
              return;
            }
            onCancel();
          }, 0);
        }}
      />
      {matches.length > 0 && box ? (
        <ul className="label-results receive-sku-menu" role="listbox" style={{ top: box.top, left: box.left, width: box.width }}>
          {matches.map((match, index) => (
            <li key={match.id}>
              <button
                type="button"
                className="label-hit"
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(match)}
              >
                <strong className="label-hit-sku">{match.sku || match.name}</strong>
                <span>{match.name}</span>
                {match.description ? <span className="label-hit-desc">{descriptionSnippet(match.description)}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {note ? <span className="sr-only">{note}</span> : null}
    </>
  );
}

function SkuCell({
  editing,
  entry,
  sku,
  onOpen,
  onPick,
  onCancel,
}: {
  editing: boolean;
  entry: ReceivingEntry;
  sku: string;
  onOpen: () => void;
  onPick: (item: LabelItem) => void;
  onCancel: () => void;
}) {
  if (editing) return <SkuEdit entry={entry} onPick={onPick} onCancel={onCancel} />;
  return (
    <CellButton
      value={sku}
      placeholder={entry.itemId ? undefined : "Link item"}
      title={entry.itemId ? "Find another item" : "Link an item"}
      onMouseDown={(event) => {
        event.preventDefault();
        onOpen();
      }}
      onClick={onOpen}
    />
  );
}

function visibleComment(entry: ReceivingEntry, pending: ReceiptPatch["item"] | null): string {
  const picked = pending && pending.id !== entry.itemId ? pending : null;
  const prep = receivePrepKind({
    shortCode: picked ? picked.shortCode : entry.shortCode,
    longCode: picked ? picked.longCode : entry.longCode,
    taxonomyName: picked ? picked.taxonomyName : entry.taxonomyName,
  });
  return commentWithStockStatus(
    entry.comment,
    prep,
    picked ? false : entry.cleaned,
    picked ? false : entry.wiped,
    picked ? false : entry.damaged,
  );
}

function DamagedBox({
  damaged,
  disabled,
  onToggle,
}: {
  damaged: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <label className="receipt-dmg">
      <input
        type="checkbox"
        checked={damaged}
        disabled={disabled}
        aria-label={damaged ? "Damaged, not for sale" : "Mark damaged"}
        onClick={(event) => {
          event.preventDefault();
          onToggle(!damaged);
        }}
      />
      DMG
    </label>
  );
}

function ConfirmBar({
  initials,
  confirm,
  error,
  saving,
  onConfirm,
  onCancel,
}: {
  initials: string;
  confirm: Confirm | null;
  error: string | null;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!confirm && !error) return null;
  return (
    <div className="receive-inline-confirm" role={confirm ? "alert" : undefined}>
      {confirm ? <p>{confirm.summary}</p> : null}
      {error ? <p className="banner error">{error}</p> : null}
      {confirm ? (
        <div className="receive-actions">
          <button type="button" disabled={saving} onClick={onConfirm}>
            {saving ? "Saving…" : "Confirm"}
          </button>
          <button type="button" className="secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <span className="hint">Recorded as {initials}.</span>
        </div>
      ) : null}
    </div>
  );
}

function VendorSelect({
  value,
  vendors,
  onCommit,
  onCancel,
}: {
  value: string;
  vendors: readonly VendorOption[];
  onCommit: (vendorId: string) => void;
  onCancel: () => void;
}) {
  const lock = useRef(false);
  const options = value && !vendors.some((vendor) => vendor.id === value) ? [...vendors, { id: value, name: "Vendor" }] : vendors;
  function commit(next: string) {
    if (lock.current) return;
    lock.current = true;
    onCommit(next);
  }
  return (
    <select
      className="cell-input receive-cell-input"
      autoFocus
      aria-label="Vendor"
      defaultValue={value}
      onChange={(event) => commit(event.target.value)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          lock.current = true;
          onCancel();
        }
      }}
    >
      <option value="">Choose a vendor</option>
      {options.map((vendor) => (
        <option key={vendor.id} value={vendor.id}>
          {vendor.name}
        </option>
      ))}
    </select>
  );
}

function ConsignmentBox({
  consigned,
  disabled,
  onToggle,
}: {
  consigned: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="receive-c"
      aria-pressed={consigned}
      aria-label={consigned ? "Consigned" : "Not consigned"}
      title={consigned ? "Consigned" : "Not consigned"}
      disabled={disabled}
      onClick={() => onToggle(!consigned)}
    >
      C
    </button>
  );
}

function OwnerAskBar({
  summary,
  saving,
  onApply,
  onDecline,
}: {
  summary: string;
  saving: boolean;
  onApply: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="receive-inline-confirm" role="alert">
      <p>{summary}</p>
      <div className="receive-actions">
        <button type="button" disabled={saving} onClick={onApply}>
          {saving ? "Saving…" : "Apply to all"}
        </button>
        <button type="button" className="secondary" disabled={saving} onClick={onDecline}>
          This line only
        </button>
      </div>
    </div>
  );
}

function itemPatch(item: LabelItem): ReceiptPatch {
  return {
    item: {
      id: item.id,
      sku: item.sku,
      name: item.name,
      shortCode: item.shortCode,
      longCode: item.longCode,
      taxonomyName: item.taxonomyName,
    },
  };
}

export function ReceiptTableRow({
  entry,
  initials,
  vendors,
  onSaved,
}: {
  entry: ReceivingEntry;
  initials: string;
  vendors: readonly VendorOption[];
  onSaved: () => void;
}) {
  const edit = useReceiptEdit(entry, onSaved, vendors);
  const shown = receiptLineAfterPick(entry, edit.pendingItem ?? null);
  const note = visibleComment(entry, edit.pendingItem);
  function open(next: Field) {
    if (edit.saving) return;
    edit.setField(next);
    edit.cancelConfirm();
  }
  return (
    <>
      <tr className={entry.itemId ? "receipt-line" : "receipt-line receipt-unmatched"}>
        <td className="fit">
          {edit.field === "date" && RECEIVING_DATE_EDITABLE ? (
            <TextEdit
              kind="date"
              value={entry.receivedOn.slice(0, 10)}
              onCommit={(value) => edit.apply({ receivedOn: value })}
              onCancel={() => edit.setField(null)}
            />
          ) : (
            <CellButton value={formatReceivedOn(entry.receivedOn)} onClick={() => RECEIVING_DATE_EDITABLE && open("date")} />
          )}
        </td>
        <td className="fit initials" title="Initials of the person who received this line">
          {entry.initials}
        </td>
        <td className="fit">
          {edit.field === "project" ? (
            <TextEdit value={entry.project ?? ""} onCommit={(value) => edit.apply({ project: value })} onCancel={() => edit.setField(null)} kind="text" />
          ) : (
            <CellButton value={entry.project ?? ""} onClick={() => open("project")} />
          )}
        </td>
        <td className="fit" title={entry.poNumber ? `PO ${entry.poNumber}` : undefined}>
          {edit.field === "vendor" ? (
            <VendorSelect
              value={entry.vendorId ?? ""}
              vendors={vendors}
              onCommit={(value) => void edit.commitVendor(value)}
              onCancel={() => edit.setField(null)}
            />
          ) : (
            <CellButton value={entry.vendorName ?? ""} title="Change vendor" onClick={() => open("vendor")} />
          )}
        </td>
        <td className="fit">
          <ConsignmentBox
            consigned={entry.ownership === "consigned"}
            disabled={edit.saving}
            onToggle={(next) => void edit.commitConsignment(next)}
          />
        </td>
        <td className="fit">
          {edit.field === "incoming" ? (
            <TextEdit
              value={entry.incomingBin ?? ""}
              onCommit={(value) => edit.apply({ incomingTag: value })}
              onCancel={() => edit.setField(null)}
              kind="text"
            />
          ) : (
            <CellButton value={entry.incomingBin ?? ""} onClick={() => open("incoming")} />
          )}
        </td>
        <td className="origin">
          {edit.field === "origin" ? (
            <TextEdit
              value={entry.originatingSystem ?? ""}
              onCommit={(value) => edit.apply({ origin: value })}
              onCancel={() => edit.setField(null)}
              kind="text"
            />
          ) : (
            <CellButton value={entry.originatingSystem ?? ""} onClick={() => open("origin")} />
          )}
        </td>
        <td className="fit num">
          {edit.field === "originQty" ? (
            <TextEdit
              kind="number"
              align="right"
              value={entry.originQty == null ? "" : String(entry.originQty)}
              onCommit={(value) => edit.apply({ originQty: value })}
              onCancel={() => edit.setField(null)}
            />
          ) : (
            <CellButton align="right" value={entry.originQty == null ? "" : String(entry.originQty)} onClick={() => open("originQty")} />
          )}
        </td>
        <td className="search" title={entry.searchQuery ?? undefined}>
          {edit.field === "search" ? (
            <TextEdit
              value={entry.searchQuery ?? ""}
              onCommit={(value) => edit.apply({ searchQuery: value })}
              onCancel={() => edit.setField(null)}
              kind="text"
            />
          ) : (
            <CellButton value={entry.searchQuery ?? ""} title={entry.searchQuery ?? undefined} onClick={() => open("search")} />
          )}
        </td>
        <td className="fit sku">
          <SkuCell
            editing={edit.field === "sku"}
            entry={entry}
            sku={shown.sku}
            onOpen={() => open("sku")}
            onPick={(item) => edit.apply(itemPatch(item))}
            onCancel={() => edit.setField(null)}
          />
        </td>
        <td className="item" title={shown.itemName}>
          {shown.itemName}
        </td>
        <td className="fit num">
          {edit.field === "qty" ? (
            <TextEdit
              kind="number"
              align="right"
              value={String(entry.qty)}
              onCommit={(value) => edit.apply({ qty: value })}
              onCancel={() => edit.setField(null)}
            />
          ) : (
            <CellButton align="right" value={String(entry.qty)} onClick={() => open("qty")} />
          )}
        </td>
        <td className="putaway" title={entry.putaway || undefined}>
          {edit.field === "putaway" ? (
            <TextEdit
              value={receiptBinReference(entry)}
              onCommit={(value) => edit.apply({ bin: value })}
              onCancel={() => edit.setField(null)}
              kind="text"
            />
          ) : (
            <CellButton value={entry.putaway} title="Change the putaway bin" onClick={() => open("putaway")} />
          )}
        </td>
        <td className="note" title={note || undefined}>
          <div className="receipt-note">
            <DamagedBox damaged={entry.damaged === true} disabled={edit.saving} onToggle={(next) => void edit.toggleDamaged(next)} />
            {edit.field === "comment" ? (
              <TextEdit value={entry.comment ?? ""} onCommit={(value) => edit.apply({ comment: value })} onCancel={() => edit.setField(null)} kind="text" />
            ) : (
              <CellButton value={note} title={note || undefined} onClick={() => open("comment")} />
            )}
          </div>
        </td>
      </tr>
      {edit.confirm || edit.ownerConfirm || edit.error ? (
        <tr className="receive-edit-row">
          <td colSpan={14}>
            <ConfirmBar
              initials={initials}
              confirm={edit.confirm}
              error={edit.error}
              saving={edit.saving}
              onConfirm={edit.confirmSave}
              onCancel={edit.cancelConfirm}
            />
            {edit.ownerConfirm ? (
              <OwnerAskBar
                summary={edit.ownerConfirm.summary}
                saving={edit.saving}
                onApply={edit.acceptOwner}
                onDecline={edit.declineOwner}
              />
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function CardLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function ReceiptCard({
  entry,
  initials,
  vendors,
  onSaved,
}: {
  entry: ReceivingEntry;
  initials: string;
  vendors: readonly VendorOption[];
  onSaved: () => void;
}) {
  const edit = useReceiptEdit(entry, onSaved, vendors);
  const shown = receiptLineAfterPick(entry, edit.pendingItem ?? null);
  const note = visibleComment(entry, edit.pendingItem);
  function open(next: Field) {
    if (edit.saving) return;
    edit.setField(next);
    edit.cancelConfirm();
  }
  return (
    <>
      <dl>
        <CardLine label="Date">
          {edit.field === "date" && RECEIVING_DATE_EDITABLE ? (
            <TextEdit
              kind="date"
              value={entry.receivedOn.slice(0, 10)}
              onCommit={(value) => edit.apply({ receivedOn: value })}
              onCancel={() => edit.setField(null)}
            />
          ) : (
            <CellButton value={formatReceivedOn(entry.receivedOn)} onClick={() => RECEIVING_DATE_EDITABLE && open("date")} />
          )}
        </CardLine>
        <CardLine label="Initials">
          <span className="initials" title="Initials of the person who received this line">
            {entry.initials}
          </span>
        </CardLine>
        <CardLine label="Project">
          {edit.field === "project" ? (
            <TextEdit value={entry.project ?? ""} onCommit={(value) => edit.apply({ project: value })} onCancel={() => edit.setField(null)} kind="text" />
          ) : (
            <CellButton value={entry.project ?? ""} onClick={() => open("project")} />
          )}
        </CardLine>
        <CardLine label="Vendor">
          {edit.field === "vendor" ? (
            <VendorSelect
              value={entry.vendorId ?? ""}
              vendors={vendors}
              onCommit={(value) => void edit.commitVendor(value)}
              onCancel={() => edit.setField(null)}
            />
          ) : (
            <CellButton value={entry.vendorName ?? ""} title={entry.poNumber ? `PO ${entry.poNumber}` : "Change vendor"} onClick={() => open("vendor")} />
          )}
        </CardLine>
        <CardLine label="Basis">
          <ConsignmentBox
            consigned={entry.ownership === "consigned"}
            disabled={edit.saving}
            onToggle={(next) => void edit.commitConsignment(next)}
          />
        </CardLine>
        <CardLine label="Incoming bin">
          {edit.field === "incoming" ? (
            <TextEdit
              value={entry.incomingBin ?? ""}
              onCommit={(value) => edit.apply({ incomingTag: value })}
              onCancel={() => edit.setField(null)}
              kind="text"
            />
          ) : (
            <CellButton value={entry.incomingBin ?? ""} onClick={() => open("incoming")} />
          )}
        </CardLine>
        <CardLine label="System">
          {edit.field === "origin" ? (
            <TextEdit
              value={entry.originatingSystem ?? ""}
              onCommit={(value) => edit.apply({ origin: value })}
              onCancel={() => edit.setField(null)}
              kind="text"
            />
          ) : (
            <CellButton value={entry.originatingSystem ?? ""} onClick={() => open("origin")} />
          )}
        </CardLine>
        <CardLine label="System Qty">
          {edit.field === "originQty" ? (
            <TextEdit
              kind="number"
              align="right"
              value={entry.originQty == null ? "" : String(entry.originQty)}
              onCommit={(value) => edit.apply({ originQty: value })}
              onCancel={() => edit.setField(null)}
            />
          ) : (
            <CellButton align="right" value={entry.originQty == null ? "" : String(entry.originQty)} onClick={() => open("originQty")} />
          )}
        </CardLine>
        <CardLine label="Search">
          {edit.field === "search" ? (
            <TextEdit
              value={entry.searchQuery ?? ""}
              onCommit={(value) => edit.apply({ searchQuery: value })}
              onCancel={() => edit.setField(null)}
              kind="text"
            />
          ) : (
            <CellButton value={entry.searchQuery ?? ""} title={entry.searchQuery ?? undefined} onClick={() => open("search")} />
          )}
        </CardLine>
        <CardLine label="SKU">
          <SkuCell
            editing={edit.field === "sku"}
            entry={entry}
            sku={shown.sku}
            onOpen={() => open("sku")}
            onPick={(item) => edit.apply(itemPatch(item))}
            onCancel={() => edit.setField(null)}
          />
        </CardLine>
        <CardLine label="Item name">
          <span title={shown.itemName}>{shown.itemName}</span>
        </CardLine>
        <CardLine label="Item Qty">
          {edit.field === "qty" ? (
            <TextEdit
              kind="number"
              align="right"
              value={String(entry.qty)}
              onCommit={(value) => edit.apply({ qty: value })}
              onCancel={() => edit.setField(null)}
            />
          ) : (
            <CellButton align="right" value={String(entry.qty)} onClick={() => open("qty")} />
          )}
        </CardLine>
        <CardLine label="Putaway location">
          {edit.field === "putaway" ? (
            <TextEdit
              value={receiptBinReference(entry)}
              onCommit={(value) => edit.apply({ bin: value })}
              onCancel={() => edit.setField(null)}
              kind="text"
            />
          ) : (
            <CellButton value={entry.putaway} title="Change the putaway bin" onClick={() => open("putaway")} />
          )}
        </CardLine>
        <CardLine label="Comment">
          <div className="receipt-note">
            <DamagedBox damaged={entry.damaged === true} disabled={edit.saving} onToggle={(next) => void edit.toggleDamaged(next)} />
            {edit.field === "comment" ? (
              <TextEdit value={entry.comment ?? ""} onCommit={(value) => edit.apply({ comment: value })} onCancel={() => edit.setField(null)} kind="text" />
            ) : (
              <CellButton value={note} onClick={() => open("comment")} />
            )}
          </div>
        </CardLine>
      </dl>
      <ConfirmBar
        initials={initials}
        confirm={edit.confirm}
        error={edit.error}
        saving={edit.saving}
        onConfirm={edit.confirmSave}
        onCancel={edit.cancelConfirm}
      />
      {edit.ownerConfirm ? (
        <OwnerAskBar
          summary={edit.ownerConfirm.summary}
          saving={edit.saving}
          onApply={edit.acceptOwner}
          onDecline={edit.declineOwner}
        />
      ) : null}
    </>
  );
}
