import { receiptFlagsForPrep, receivePrepKind } from "@/lib/receivingLine";
import { receiptChangeSummary, receiptSearchQuery } from "@/lib/receivingScan";
import { originQtyInput, parseReceiptDate, type ReceivingEntry } from "@/lib/receivingSettings";

/** Fields a clerk can change on a recent receipt. Putaway is not one of them. */
export type ReceiptPatch = {
  receivedOn?: string;
  project?: string;
  incomingTag?: string;
  origin?: string;
  originQty?: string;
  comment?: string;
  searchQuery?: string;
  qty?: string;
  item?: {
    id: string;
    sku: string;
    name: string;
    shortCode?: string | null;
    longCode?: string | null;
    taxonomyName?: string | null;
  };
  cleaned?: boolean;
  wiped?: boolean;
};

export type ReceiptEditBody = {
  receivedOn: string;
  project: string;
  incomingTag: string;
  origin: string;
  originQty: number | null;
  comment: string;
  qty: number;
  itemId: string;
  sku: string;
  cleaned: boolean | null;
  wiped: boolean | null;
  searchQuery: string | null;
};

export type ReceiptEditPlan =
  | { action: "unchanged" }
  | { action: "invalid"; message: string }
  | { action: "confirm"; summary: string; body: ReceiptEditBody }
  | { action: "save"; body: ReceiptEditBody };

function text(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** The row shows the picked item's name as soon as the SKU changes. Cancel restores the saved line. */
export function receiptLineAfterPick(
  entry: { itemId: string; sku: string; itemName: string },
  picked: { id: string; sku: string; name: string } | null,
): { sku: string; itemName: string } {
  if (!picked || picked.id === entry.itemId) return { sku: entry.sku, itemName: entry.itemName };
  return { sku: text(picked.sku) || text(picked.name), itemName: picked.name };
}

function parseEditQty(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000000) return null;
  return parsed;
}

function limit(value: string, max: number, label: string): string | null {
  if (value.length > max) return `${label} must be ${max} characters or fewer.`;
  return null;
}

/**
 * One cell change, checked against the receipt already on screen.
 * Qty or a different item asks for confirmation. Anything else can save immediately.
 * The destination bin is not part of the patch.
 */
export function planReceiptEdit(entry: ReceivingEntry, patch: ReceiptPatch, confirmed: boolean): ReceiptEditPlan {
  let receivedOn = "";
  try {
    receivedOn = parseReceiptDate(patch.receivedOn ?? entry.receivedOn.slice(0, 10));
  } catch (error) {
    return { action: "invalid", message: error instanceof Error ? error.message : "Enter a receiving date." };
  }
  const project = text(patch.project ?? entry.project);
  const incomingTag = text(patch.incomingTag ?? entry.incomingBin);
  const origin = text(patch.origin ?? entry.originatingSystem);
  const comment = text(patch.comment ?? entry.comment);
  const searchQuery = receiptSearchQuery(patch.searchQuery !== undefined ? patch.searchQuery : entry.searchQuery);
  const projectError = limit(project, 120, "Project");
  if (projectError) return { action: "invalid", message: projectError };
  const incomingError = limit(incomingTag, 120, "Incoming bin");
  if (incomingError) return { action: "invalid", message: incomingError };
  const originError = limit(origin, 500, "Originating system");
  if (originError) return { action: "invalid", message: originError };
  const commentError = limit(comment, 500, "Comment");
  if (commentError) return { action: "invalid", message: commentError };

  const originParsed = originQtyInput(patch.originQty ?? (entry.originQty == null ? "" : String(entry.originQty)));
  if (!originParsed.ok) return { action: "invalid", message: "Originating system qty is a whole number from 0 to 1000000." };
  const qty = parseEditQty(patch.qty ?? String(entry.qty));
  if (qty == null) return { action: "invalid", message: "Enter a whole number from 0 to 1000000." };

  const item = patch.item;
  const itemId = item?.id ?? entry.itemId;
  const sku = text(item ? item.sku || item.name : entry.sku);
  if (!itemId) return { action: "invalid", message: "Choose an item." };

  const itemChanged = itemId !== entry.itemId;
  const prep = receivePrepKind({
    shortCode: item ? item.shortCode : entry.shortCode,
    longCode: item ? item.longCode : entry.longCode,
    taxonomyName: item ? item.taxonomyName : entry.taxonomyName,
  });
  const flags =
    itemChanged || patch.cleaned !== undefined || patch.wiped !== undefined
      ? receiptFlagsForPrep(
          prep,
          itemChanged ? (patch.cleaned ?? false) : (patch.cleaned ?? entry.cleaned === true),
          itemChanged ? (patch.wiped ?? false) : (patch.wiped ?? entry.wiped === true),
        )
      : { cleaned: entry.cleaned, wiped: entry.wiped };

  const body: ReceiptEditBody = {
    receivedOn,
    project,
    incomingTag,
    origin,
    originQty: originParsed.qty,
    comment,
    qty,
    itemId,
    sku,
    cleaned: flags.cleaned,
    wiped: flags.wiped,
    searchQuery,
  };

  const same =
    receivedOn === entry.receivedOn.slice(0, 10) &&
    project === text(entry.project) &&
    incomingTag === text(entry.incomingBin) &&
    origin === text(entry.originatingSystem) &&
    body.originQty === entry.originQty &&
    comment === text(entry.comment) &&
    qty === entry.qty &&
    itemId === entry.itemId &&
    flags.cleaned === entry.cleaned &&
    flags.wiped === entry.wiped &&
    searchQuery === receiptSearchQuery(entry.searchQuery);
  if (same) return { action: "unchanged" };

  let summary = receiptChangeSummary({ sku: entry.sku, nextSku: sku, qty: entry.qty, nextQty: qty });
  if (!summary && itemChanged) {
    summary = `Change SKU from ${text(entry.sku) || "blank"} to ${sku || "blank"}? This posts an adjustment. The bin can't go below 0.`;
  }
  if (summary && !confirmed) return { action: "confirm", summary, body };
  return { action: "save", body };
}
