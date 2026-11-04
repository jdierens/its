/**
 * Unknown serials on a pick are not refused outright.
 * The operator confirms, and a yes records them as Pulled:
 * issued onto the pick when it has no warehouse bin, or into the staging bin when one is assigned.
 * A serial-only paste resolves a known unit to its item and bin and builds that pull.
 */

import { lineRemaining } from "@/lib/pickSheet";
import { formatPullFrom } from "@/lib/pickSerialLocation";
import {
  pickSlotForSerial,
  UNKNOWN_SERIAL_MESSAGE,
  type SerialPasteFailure,
  type SerialPasteReport,
} from "@/lib/pickSerialPaste";

export const PULLED_FROM = "Pulled";

/** x/y counts are the unknown serials over every serial in the paste or entry. */
export function unknownSerialPrompt(unknown: number, total: number): string {
  const counts = `${unknown}/${total}`;
  const lead = unknown >= total && total > 0 ? `All ${counts}` : counts;
  const noun = unknown === 1 ? "unknown serial number is" : "unknown serial numbers are";
  const ask = unknown === 1 ? "Add this as Pulled?" : "Add these as Pulled?";
  return `${lead} ${noun} not in inventory. ${ask}`;
}

export function pullFromLabel(fromBin: string | null | undefined): string {
  const value = fromBin?.trim();
  return value ? value : PULLED_FROM;
}

export type ResolvedSerialPull = {
  serial: string;
  allocationId: string;
  binId: string;
  reference: string;
  coo: string | null;
};

export type SerialPullAction =
  | { type: "attach"; pickId: string }
  | { type: "pick"; allocationId: string; binId: string }
  | { type: "fail"; message: string };

type PullSlot = {
  id: string;
  fromBin: string | null;
  qty: number;
  serials: readonly unknown[];
};

/**
 * A known serial attaches to a pull that still has room.
 * Otherwise the next step is a quantity of one from the bin it is in, when the line still needs pieces.
 */
export function actionForResolvedSerial(input: {
  pull: ResolvedSerialPull;
  picks: readonly PullSlot[];
  remaining: number;
}): SerialPullAction {
  const slot = pickSlotForSerial({ picks: input.picks, reference: input.pull.reference });
  if (slot.ok) return { type: "attach", pickId: slot.pickId };
  if (input.remaining >= 1 && needsAnotherPiece(slot.message)) {
    return { type: "pick", allocationId: input.pull.allocationId, binId: input.pull.binId };
  }
  return { type: "fail", message: slot.message };
}

function needsAnotherPiece(message: string): boolean {
  return message.startsWith("Pick a quantity") || message.startsWith("This pick already has a serial");
}

type SerialRoomLine = {
  allocationId: string;
  ordered: number;
  picked: number;
  picks?: readonly { qty: number; serials: readonly unknown[] }[];
};

/** A line can take a serial when quantity is still open, or a pull on it has no serial yet. */
export function lineCanTakeSerial(line: SerialRoomLine): boolean {
  if (lineRemaining(line.ordered, line.picked) >= 1) return true;
  return (line.picks ?? []).some((pick) => pick.serials.length < pick.qty);
}

type SerialSlot = {
  id: string;
  fromBin: string | null;
  qty: number;
  serials: readonly unknown[];
};

/**
 * The + control attaches to a pick that still has room.
 * A serial lookup names the bin. Otherwise the bin just picked in the table is used,
 * which is the latest open slot. A typed serial is not looked up again before this choice.
 */
export function serialAddTarget(input: {
  picks: readonly SerialSlot[];
  preferredBin?: string | null;
}): { ok: true; pickId: string; fromBin: string | null } | { ok: false; message: string } {
  const open = input.picks.filter((pick) => pick.qty > 0 && pick.serials.length < pick.qty);
  const preferred = input.preferredBin?.trim() ?? "";
  if (preferred) {
    const match = [...open].reverse().find((pick) => (pick.fromBin ?? "").trim().toUpperCase() === preferred.toUpperCase());
    if (match) return { ok: true, pickId: match.id, fromBin: match.fromBin };
    return { ok: false, message: `Pick a quantity from ${preferred} before adding this serial.` };
  }
  const slot = open[open.length - 1];
  if (!slot) return { ok: false, message: "Pick a quantity from a bin above before adding a serial." };
  return { ok: true, pickId: slot.id, fromBin: slot.fromBin };
}

/** From on the serial row. A lookup wins. Otherwise it is the bin the + control will use. */
export function serialRowFrom(input: {
  active: { reference: string; location: string | null } | null;
  fromBin: string | null;
  bins: readonly { reference: string; location: string | null }[];
}): string {
  if (input.active?.reference.trim()) return formatPullFrom(input.active.reference, input.active.location);
  const bin = input.fromBin?.trim() ?? "";
  if (!bin) return "";
  const match = input.bins.find((row) => row.reference.trim().toUpperCase() === bin.toUpperCase());
  return formatPullFrom(bin, match?.location?.trim() || null);
}

/** The line a confirmed unknown serial is added to. A paste on a row wins. One open line is enough. */
export function pulledAllocationForUnknowns(input: {
  allocationId: string | null;
  lines: readonly SerialRoomLine[];
}): string | null {
  if (input.allocationId) return input.allocationId;
  const open = input.lines.filter((line) => lineCanTakeSerial(line));
  if (open.length === 1) return open[0].allocationId;
  return null;
}

export function declineUnknownSerials(report: SerialPasteReport): SerialPasteReport {
  const declined: SerialPasteFailure[] = report.unknown.map((serial) => ({
    serial,
    message: UNKNOWN_SERIAL_MESSAGE,
  }));
  return {
    accepted: report.accepted,
    failures: [...report.failures, ...declined],
    unknown: [],
  };
}

export function mergeSerialReports(first: SerialPasteReport, second: SerialPasteReport): SerialPasteReport {
  return {
    accepted: first.accepted + second.accepted,
    failures: [...first.failures, ...second.failures],
    unknown: second.unknown,
  };
}
