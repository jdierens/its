import { lineRemaining } from "@/lib/pickSheet";

export type KnownSerialUnit = {
  serial: string;
  sku: string;
  onOrder: boolean;
  status: string;
  binId: string | null;
  reference: string | null;
  location: string | null;
  coo: string | null;
};

export type SerialPullLine = {
  allocationId: string;
  sku: string;
  remaining: number;
  bins: readonly { binId: string; reference: string; qty: number }[];
};

export type SerialPull = {
  serial: string;
  sku: string;
  allocationId: string;
  binId: string;
  reference: string;
  location: string | null;
  coo: string | null;
};

export type SerialPullResult = { ok: true; pull: SerialPull } | { ok: false; message: string };

/** Escape a serial for an exact ILIKE match. A wildcard in the scan must not widen the lookup. */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function formatPullFrom(reference: string, location: string | null): string {
  return location ? `${reference} · ${location}` : reference;
}

export function pullCue(pull: Pick<SerialPull, "serial" | "reference" | "location">): string {
  return `Pulling ${pull.serial} from ${formatPullFrom(pull.reference, pull.location)}.`;
}

function fail(message: string): SerialPullResult {
  return { ok: false, message };
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * A scanned serial fills the pick-from location only when that exact unit is
 * in a bin on this order. An unknown serial, or a unit that has left its bin,
 * does not invent a location.
 */
export function resolveSerialPull(input: {
  serial: string;
  units: readonly KnownSerialUnit[];
  lines: readonly SerialPullLine[];
  allocationId?: string | null;
}): SerialPullResult {
  const serial = input.serial.trim();
  if (!serial) return fail("Enter a serial.");

  const units = input.units.filter((unit) => sameText(unit.serial, serial));
  if (units.length === 0) return fail("That serial is not in inventory.");

  const orderUnits = units.filter((unit) => unit.onOrder);
  if (orderUnits.length === 0) return fail("That serial is not on this pick.");

  const stocked = orderUnits.filter(
    (unit) => unit.status === "in_stock" && unit.binId && unit.reference && unit.reference.trim(),
  );
  if (stocked.length === 0) return fail("That serial is not in a bin.");

  const skus = [...new Set(stocked.map((unit) => unit.sku.trim().toLowerCase()))];
  if (skus.length > 1) return fail("That serial matches more than one item on this pick.");

  const binIds = [...new Set(stocked.map((unit) => unit.binId))];
  if (binIds.length > 1) return fail("That serial is in more than one bin.");

  const unit = stocked[0];
  const place = formatPullFrom(unit.reference!.trim(), unit.location);
  let candidates = input.lines.filter((line) => sameText(line.sku, unit.sku));

  if (input.allocationId) {
    const line = input.lines.find((row) => row.allocationId === input.allocationId);
    if (!line) return fail("That line is not on this pick.");
    if (!sameText(line.sku, unit.sku)) return fail("That serial is not on this line.");
    candidates = [line];
  }

  if (candidates.length === 0) return fail("That serial is not on this pick.");

  const withBin = candidates.filter((line) =>
    line.bins.some((bin) => bin.binId === unit.binId && bin.qty > 0),
  );
  if (withBin.length === 0) {
    return fail(`That serial is in ${place}, which is not open on this pick.`);
  }

  const line = withBin.find((row) => row.remaining >= 1) ?? withBin[0];
  return {
    ok: true,
    pull: {
      serial: unit.serial.trim(),
      sku: line.sku,
      allocationId: line.allocationId,
      binId: unit.binId!,
      reference: unit.reference!.trim(),
      location: unit.location?.trim() || null,
      coo: unit.coo?.trim() || null,
    },
  };
}

export function serialPullLines(
  lines: readonly { allocationId: string; sku: string; ordered: number; picked: number; bins: readonly { binId: string; reference: string; qty: number }[] }[],
): SerialPullLine[] {
  return lines.map((line) => ({
    allocationId: line.allocationId,
    sku: line.sku,
    remaining: lineRemaining(line.ordered, line.picked),
    bins: line.bins,
  }));
}
