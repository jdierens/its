export const BIN_CODE_PATTERN = /^\d{5}-[BCP]$/;

export type BinImportRow = {
  code: string;
  location: string;
  note: string;
};

export type BinRowStatus = "new" | "exists" | "error";

export type ClassifiedBinRow = BinImportRow & {
  row: number;
  status: BinRowStatus;
  reason: string | null;
};

export type BinImportContext = {
  existingByNumber: Map<number, string>;
  locations: Set<string>;
  defaults: Partial<Record<"B" | "C" | "P", string>>;
  nextNumber: number;
};

export type CounterBump = {
  before: number;
  after: number;
  bumped: boolean;
};

const CODE_ERROR = "A bin code is five digits, a hyphen, and B, C, or P.";

export function suffixFromType(value: string): string {
  const token = value.trim().toLowerCase();
  if (token === "b" || token === "box") return "B";
  if (token === "c" || token === "crate") return "C";
  if (token === "p" || token === "pallet") return "P";
  return "";
}

/** Zero-pad a short number and, when the code has no suffix, take one from the type column. */
export function composeBinCode(code: string, type: string): string {
  const compact = code.trim().toUpperCase().replace(/\s+/g, "");
  if (!compact) return "";
  const split = compact.match(/^(\d+)-([A-Z]+)$/);
  let digits = "";
  let suffix = "";
  if (split) {
    digits = split[1];
    suffix = split[2];
  } else if (/^\d+$/.test(compact)) {
    digits = compact;
  } else {
    return compact;
  }
  if (digits.length > 0 && digits.length < 5) digits = digits.padStart(5, "0");
  if (!suffix) suffix = suffixFromType(type);
  return suffix ? `${digits}-${suffix}` : digits;
}

export function importRowsFromMapped(records: Record<string, string>[]): BinImportRow[] {
  return records
    .map((record) => ({
      code: composeBinCode(record.code ?? "", record.type ?? ""),
      location: (record.location ?? "").trim(),
      note: (record.note ?? "").trim(),
    }))
    .filter((row) => row.code !== "" || row.location !== "" || row.note !== "");
}

export function counterAfterImport(nextNumber: number, importedNumbers: number[]): CounterBump {
  if (!importedNumbers.some((number) => number >= nextNumber)) {
    return { before: nextNumber, after: nextNumber, bumped: false };
  }
  return { before: nextNumber, after: Math.max(...importedNumbers) + 1, bumped: true };
}

export function classifyBinRows(rows: BinImportRow[], context: BinImportContext): {
  rows: ClassifiedBinRow[];
  counter: CounterBump;
} {
  const seenCodes = new Set<string>();
  const seenNumbers = new Set<number>();
  const classified: ClassifiedBinRow[] = rows.map((row, index) => {
    const code = row.code.trim().toUpperCase();
    const location = row.location.trim().toUpperCase();
    const note = row.note.trim();
    const base = { row: index + 1, code, location, note };

    if (!BIN_CODE_PATTERN.test(code)) {
      return { ...base, status: "error" as const, reason: CODE_ERROR };
    }
    const number = Number(code.slice(0, 5));
    if (number < 1) return { ...base, status: "error" as const, reason: CODE_ERROR };
    if (seenCodes.has(code) || seenNumbers.has(number)) {
      return { ...base, status: "error" as const, reason: "Duplicate in file." };
    }
    if (note.length > 2000) return { ...base, status: "error" as const, reason: "Note is too long." };

    const existing = context.existingByNumber.get(number);
    if (existing) {
      if (existing === code) {
        seenCodes.add(code);
        seenNumbers.add(number);
        return { ...base, status: "exists" as const, reason: "Already exists." };
      }
      return { ...base, status: "error" as const, reason: `${number} is already used by ${existing}.` };
    }

    const suffix = code.slice(-1) as "B" | "C" | "P";
    let resolved = location;
    if (!location) {
      const fallback = context.defaults[suffix];
      if (!fallback) {
        return { ...base, status: "error" as const, reason: "No default location for this bin type." };
      }
      resolved = fallback;
    } else if (!context.locations.has(location)) {
      return { ...base, status: "error" as const, reason: `Unknown location ${location}.` };
    }

    seenCodes.add(code);
    seenNumbers.add(number);
    return { ...base, location: resolved, status: "new" as const, reason: null };
  });

  const imported = classified
    .filter((row) => row.status === "new")
    .map((row) => Number(row.code.slice(0, 5)));
  return { rows: classified, counter: counterAfterImport(context.nextNumber, imported) };
}
