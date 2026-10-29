/**
 * A spreadsheet paste into the pick serial field.
 * A column is one serial per line. A row is tab-separated. Blank cells are dropped.
 * One serial stays in the field so Enter still scans it.
 */

import { errorText } from "@/lib/errors";
import { serialProblem } from "@/lib/pickSheet";

export type SerialPastePlan =
  | { type: "default" }
  | { type: "ignore" }
  | { type: "fill"; serial: string }
  | { type: "apply"; serials: string[] };

export type PastedSerialPull = {
  serial: string;
  reference: string;
  coo: string | null;
};

export type SerialPasteFailure = {
  serial: string;
  message: string;
};

export type SerialPasteReport = {
  accepted: number;
  failures: SerialPasteFailure[];
};

type PickSlot = {
  id: string;
  fromBin: string | null;
  qty: number;
  serials: readonly unknown[];
};

/** Split a Google Sheets cell range. Columns are newlines. Rows are tabs. Empty cells are dropped. */
export function parsePastedSerials(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/[\t\r\n]+/)
    .map((part) => part.replace(/^\uFEFF/, "").trim())
    .filter((part) => part.length > 0);
}

/**
 * A plain serial is left to the input. A range with more than one cell is applied.
 * One cell that brings a trailing line break only fills the field.
 */
export function classifySerialPaste(text: string): SerialPastePlan {
  if (!/[\t\r\n]/.test(text)) return { type: "default" };
  const serials = parsePastedSerials(text);
  if (serials.length === 0) return { type: "ignore" };
  if (serials.length === 1) return { type: "fill", serial: serials[0] };
  return { type: "apply", serials };
}

/** The pick row that still has room for a serial from this bin. */
export function pickSlotForSerial(input: {
  picks: readonly PickSlot[];
  reference: string;
}): { ok: true; pickId: string } | { ok: false; message: string } {
  const reference = input.reference.trim();
  const fromHere = input.picks.filter(
    (row) => (row.fromBin ?? "").trim().toUpperCase() === reference.toUpperCase(),
  );
  const open = fromHere.find((row) => row.serials.length < row.qty);
  if (open) return { ok: true, pickId: open.id };
  if (fromHere.length > 0) return { ok: false, message: "This pick already has a serial for each piece." };
  return { ok: false, message: `Pick a quantity from ${reference} before adding this serial.` };
}

/** A lookup has to name the unit and the bin it is in. Anything else is a failed read. */
function pastedPull(value: unknown): PastedSerialPull | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { serial?: unknown; reference?: unknown; coo?: unknown };
  if (typeof row.serial !== "string" || typeof row.reference !== "string" || !row.reference.trim()) return null;
  if (row.coo != null && typeof row.coo !== "string") return null;
  const coo = typeof row.coo === "string" ? row.coo.trim() || null : null;
  return { serial: row.serial, reference: row.reference.trim(), coo };
}

/**
 * Add each pasted serial the same way as Add: look up the unit, then attach it
 * to a pick that still has room. One failure does not stop the rest.
 * A lookup that returns nothing fails that serial only.
 */
export async function applyPastedSerials(input: {
  serials: readonly string[];
  sku: string;
  coo: string;
  existing: () => readonly string[];
  picks: () => readonly PickSlot[];
  lookup: (serial: string) => Promise<unknown>;
  record: (pickId: string, serial: string, coo: string | null) => Promise<void>;
}): Promise<SerialPasteReport> {
  const failures: SerialPasteFailure[] = [];
  let accepted = 0;
  const coo = input.coo.trim();
  for (const raw of input.serials) {
    const serial = raw.trim();
    const problem = serialProblem({ serial, sku: input.sku, existing: input.existing() });
    if (problem) {
      failures.push({ serial: serial || raw, message: problem });
      continue;
    }
    let label = serial || raw;
    try {
      const found = pastedPull(await input.lookup(serial));
      if (!found) {
        failures.push({ serial: label, message: "That serial could not be looked up." });
        continue;
      }
      const canonical = found.serial.trim() || serial;
      label = canonical;
      if (input.existing().some((row) => row.toLowerCase() === canonical.toLowerCase())) {
        failures.push({ serial: canonical, message: "That serial is already recorded for this item." });
        continue;
      }
      const slot = pickSlotForSerial({ picks: input.picks(), reference: found.reference });
      if (!slot.ok) {
        failures.push({ serial: canonical, message: slot.message });
        continue;
      }
      await input.record(slot.pickId, canonical, coo || found.coo);
      accepted += 1;
    } catch (cause) {
      failures.push({ serial: label, message: errorText(cause) });
    }
  }
  return { accepted, failures };
}

export function formatSerialPasteReport(report: SerialPasteReport): { accepted: string | null; failures: string | null } {
  const accepted =
    report.accepted > 0
      ? report.accepted === 1
        ? "Accepted 1 serial."
        : `Accepted ${report.accepted} serials.`
      : null;
  if (report.failures.length === 0) return { accepted, failures: null };
  const heading =
    report.failures.length === 1 ? "1 serial was not added." : `${report.failures.length} serials were not added.`;
  const lines = report.failures.map((failure) => `${failure.serial}: ${failure.message}`);
  return { accepted, failures: [heading, ...lines].join("\n") };
}
