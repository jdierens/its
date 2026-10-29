import { CONSIGNED_VENDOR_REQUIRED } from "@/lib/consignedReceive";
import type { ColumnSpec, DataTable } from "@/lib/data/registry";
import {
  RECEIVING_DATE_EDITABLE,
  originQtyInput,
  parseReceiptDate,
  receiveLineQty,
  systemQtyMultipleWarning,
} from "@/lib/receivingSettings";
import { parseReceivingBinCode } from "@/lib/stockReceive";
import { SERIAL_MAX_LENGTH, cooProblem, normalizeCooCode, normalizeSerial } from "@/lib/stockUnits";

export const RECEIVING_IMPORT_MIGRATION = "supabase/migrations/20261029040000_receiving_import.sql";

/** Same shape place_received_units rejects as a bin scan rather than a serial. */
const SERIAL_BIN = /^\d{1,5}-[A-Za-z]$/;

const YES = new Set(["yes", "y", "true", "1", "x", "checked"]);
const NO = new Set(["", "no", "n", "false", "0", "unchecked"]);

function column(spec: Omit<ColumnSpec, "money" | "export"> & { export?: boolean }): ColumnSpec {
  return { ...spec, money: false, export: spec.export ?? false };
}

export const RECEIVING_TABLE: DataTable = {
  id: "receiving",
  label: "Receiving",
  description: "Receive a list of items into bins. A row with no purchase order is consigned to a vendor.",
  naturalKey: [],
  policy: "insert",
  importable: true,
  exportable: false,
  columns: [
    column({
      key: "sku",
      required: false,
      template: true,
      format: "An existing item SKU",
      example: "94415",
      description: "Exact SKU. Required unless Search is filled. Search with no SKU stores a pending line and does not move stock.",
      allowed: [],
      synonyms: ["sku", "item", "item sku", "item #"],
    }),
    column({
      key: "search",
      required: false,
      template: true,
      format: "Text, up to 500 characters",
      example: "samsung 860",
      description: "Stored on the receipt as the search text. Required when SKU is blank.",
      allowed: [],
      synonyms: ["search", "search query", "query"],
    }),
    column({
      key: "qty",
      required: true,
      template: true,
      format: "Whole number from 1 to 1000000",
      example: "4",
      description: "Item quantity received into the bin.",
      allowed: [],
      synonyms: ["qty", "quantity", "item qty", "item quantity"],
    }),
    column({
      key: "bin",
      required: true,
      template: true,
      format: "Five digits, a hyphen, and B, C, or P",
      example: "10059-C",
      description: "Putaway bin. The bin must already exist. Import does not create bins.",
      allowed: ["B box", "C crate", "P pallet"],
      synonyms: ["bin", "putaway", "bin code", "bin #", "reference"],
    }),
    column({
      key: "vendor",
      required: false,
      template: true,
      format: "Vendor display name",
      example: "Example Vendor",
      description:
        "Required when Purchase order is blank. The receipt is then consigned to that vendor. A blank cell uses the vendor on the receiving page.",
      allowed: [],
      synonyms: ["vendor", "vendor name", "consignor"],
    }),
    column({
      key: "purchase_order",
      required: false,
      template: true,
      format: "Purchase order number, such as PO6304",
      example: "",
      description:
        "Optional. The vendor on that order is used, and the receipt is not consigned. A blank cell uses the purchase order on the receiving page, if one is chosen.",
      allowed: [],
      synonyms: ["purchase order", "purchase_order", "po", "po number", "po #"],
    }),
    column({
      key: "project",
      required: false,
      template: true,
      format: "Text, up to 120 characters",
      example: "Example project",
      description: "Receipt project. A blank cell uses the project on the receiving page.",
      allowed: [],
      synonyms: ["project"],
    }),
    column({
      key: "received_on",
      required: false,
      template: true,
      format: "YYYY-MM-DD",
      example: "2026-10-29",
      description: "Receiving date. A blank cell uses the date on the receiving page, or today.",
      allowed: [],
      synonyms: ["received on", "received_on", "receiving date", "date"],
    }),
    column({
      key: "incoming_bin",
      required: false,
      template: true,
      format: "Text, up to 120 characters",
      example: "DOCK-1",
      description: "Incoming bin. A blank cell uses the incoming bin on the receiving page.",
      allowed: [],
      synonyms: ["incoming bin", "incoming", "incoming tag", "incoming_bin"],
    }),
    column({
      key: "origin",
      required: false,
      template: true,
      format: "Text, up to 500 characters",
      example: "eBay",
      description: "Originating system. A blank cell uses the originating system on the receiving page.",
      allowed: [],
      synonyms: ["origin", "originating system", "system", "origin description"],
    }),
    column({
      key: "origin_qty",
      required: false,
      template: true,
      format: "Whole number from 0 to 1000000",
      example: "4",
      description: "Quantity the originating system reports. Not the quantity put in the bin.",
      allowed: [],
      synonyms: ["origin qty", "orig system qty", "system qty", "origin_qty", "originating system qty"],
    }),
    column({
      key: "comment",
      required: false,
      template: true,
      format: "Text, up to 500 characters",
      example: "sample row - replace before import",
      description: "Note stored on the receipt. Cleaned and Wiped are not written into the comment.",
      allowed: [],
      synonyms: ["comment", "note", "notes"],
    }),
    column({
      key: "cleaned",
      required: false,
      template: true,
      format: "yes or no",
      example: "no",
      description: "CPU lines only. Blank is no. Stored as false when the box is left unchecked. Ignored for other items.",
      allowed: ["yes", "no"],
      synonyms: ["cleaned", "clean"],
    }),
    column({
      key: "wiped",
      required: false,
      template: true,
      format: "yes or no",
      example: "no",
      description: "SSD and HDD lines only. Blank is no. Stored as false when the box is left unchecked. Ignored for other items.",
      allowed: ["yes", "no"],
      synonyms: ["wiped", "wipe"],
    }),
    column({
      key: "serial",
      required: false,
      template: true,
      format: "One serial, or several separated by a semicolon, a pipe, or a new line",
      example: "SN-1001",
      description: "Optional. At most one serial per piece. Requires a SKU. Each serial is one stock unit.",
      allowed: [],
      synonyms: ["serial", "serial number", "serials", "sn"],
    }),
    column({
      key: "country_of_origin",
      required: false,
      template: true,
      format: "2- or 3-letter country code",
      example: "USA",
      description:
        "Optional country of origin. Applied to each serial on the row. With no serial, one stock unit is recorded with that country.",
      allowed: [],
      synonyms: ["country of origin", "country_of_origin", "coo", "country", "origin country"],
    }),
  ],
};

export type ReceivingImportDefaults = {
  project: string;
  receivedOn: string;
  incomingBin: string;
  origin: string;
  originQty: string;
  vendorId: string;
  vendorName: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
};

export type ReceivingUnitInput = {
  serial: string | null;
  coo: string | null;
};

export type PreparedReceivingRow = {
  row: number;
  sku: string;
  search: string;
  qty: number | null;
  bin: string;
  vendorName: string;
  vendorId: string | null;
  purchaseOrder: string;
  purchaseOrderId: string | null;
  project: string;
  receivedOn: string;
  incomingBin: string;
  origin: string;
  originQty: number | null;
  comment: string;
  cleaned: boolean;
  wiped: boolean;
  units: ReceivingUnitInput[];
  clientRequestId: string;
  error: string | null;
  note: string | null;
};

export type ReceivingRpcRow = {
  row: number;
  sku: string;
  search: string;
  qty: number;
  bin: string;
  vendor_name: string;
  vendor_id: string | null;
  purchase_order: string;
  purchase_order_id: string | null;
  project: string;
  received_on: string;
  incoming_bin: string;
  origin: string;
  origin_qty: number | null;
  comment: string;
  cleaned: boolean;
  wiped: boolean;
  units: ReceivingUnitInput[];
  client_request_id: string;
};

export function emptyReceivingDefaults(): ReceivingImportDefaults {
  return {
    project: "",
    receivedOn: "",
    incomingBin: "",
    origin: "",
    originQty: "",
    vendorId: "",
    vendorName: "",
    purchaseOrderId: "",
    purchaseOrderNumber: "",
  };
}

export function parseReceivingFlag(value: string, label: "Cleaned" | "Wiped"): { ok: true; value: boolean } | { ok: false; message: string } {
  const token = value.trim().toLowerCase();
  if (NO.has(token)) return { ok: true, value: false };
  if (YES.has(token)) return { ok: true, value: true };
  return { ok: false, message: `${label} is yes or no.` };
}

/** One serial, or several split on a new line, a semicolon, or a pipe. A comma stays inside the serial. */
export function splitReceivingSerials(value: string): string[] {
  return value
    .split(/\r?\n|[;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeImportDate(value: string): string {
  const text = value.trim();
  const stamped = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/);
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  let iso = "";
  if (stamped) iso = stamped[1];
  else if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (!iso) throw new Error("Enter a receiving date as YYYY-MM-DD.");
  return parseReceiptDate(iso);
}

function cell(record: Record<string, string>, key: string): string {
  return (record[key] ?? "").trim();
}

export function receivingRowIsBlank(record: Record<string, string>): boolean {
  return RECEIVING_TABLE.columns.every((column) => cell(record, column.key) === "");
}

function lengthError(value: string, max: number, message: string): string | null {
  return value.length > max ? message : null;
}

function serialProblem(serial: string, sku: string, seen: readonly string[]): string | null {
  if (serial.length > SERIAL_MAX_LENGTH) return "A serial is at most 80 characters.";
  if (sku && serial.toUpperCase() === sku.toUpperCase()) return "That scan is the SKU, not a serial.";
  if (SERIAL_BIN.test(serial)) return "That scan is a bin code, not a serial.";
  if (seen.some((row) => row.toLowerCase() === serial.toLowerCase())) return "That serial is already in this receipt.";
  return null;
}

function takeError(current: string | null, next: string | null): string | null {
  return current ?? next;
}

export function prepareReceivingImport(
  records: readonly Record<string, string>[],
  defaults: ReceivingImportDefaults,
  requestIds: readonly string[],
  today: string,
): PreparedReceivingRow[] {
  const prepared: PreparedReceivingRow[] = [];
  const seenAcross = new Map<string, string>();

  records.forEach((record, index) => {
    if (receivingRowIsBlank(record)) return;
    const rowNumber = index + 2;
    let error: string | null = null;

    const sku = cell(record, "sku");
    const search = cell(record, "search");
    const qtyText = cell(record, "qty");
    const binText = cell(record, "bin");
    const sheetVendor = cell(record, "vendor");
    const sheetPo = cell(record, "purchase_order");
    const project = cell(record, "project") || defaults.project.trim();
    const incomingBin = cell(record, "incoming_bin") || defaults.incomingBin.trim();
    const origin = cell(record, "origin") || defaults.origin.trim();
    const originQtyText = cell(record, "origin_qty") || defaults.originQty.trim();
    const comment = cell(record, "comment");
    const serialText = cell(record, "serial");
    const cooText = cell(record, "country_of_origin");

    const qtyParsed = receiveLineQty(qtyText);
    const qty = qtyParsed.ok ? qtyParsed.qty : null;
    if (!qtyParsed.ok) error = takeError(error, qtyParsed.message);

    const parsedBin = parseReceivingBinCode(binText);
    const bin = parsedBin?.reference ?? binText.toUpperCase();
    if (!binText) error = takeError(error, "Enter a bin.");
    else if (!parsedBin) error = takeError(error, "A bin code is five digits, a hyphen, and B, C, or P.");

    let receivedOn = "";
    if (!RECEIVING_DATE_EDITABLE) {
      receivedOn = today;
    } else {
      const rawDate = cell(record, "received_on") || defaults.receivedOn.trim() || today;
      try {
        receivedOn = normalizeImportDate(rawDate);
      } catch (cause) {
        error = takeError(error, cause instanceof Error ? cause.message : "Enter a receiving date.");
      }
    }

    const originParsed = originQtyInput(originQtyText);
    const originQty = originParsed.ok ? originParsed.qty : null;
    if (!originParsed.ok) error = takeError(error, "Originating system qty is a whole number from 0 to 1000000.");

    const cleanedFlag = parseReceivingFlag(cell(record, "cleaned"), "Cleaned");
    const wipedFlag = parseReceivingFlag(cell(record, "wiped"), "Wiped");
    if (!cleanedFlag.ok) error = takeError(error, cleanedFlag.message);
    if (!wipedFlag.ok) error = takeError(error, wipedFlag.message);

    error = takeError(error, lengthError(comment, 500, "Comment must be 500 characters or fewer."));
    error = takeError(error, lengthError(origin, 500, "Originating system must be 500 characters or fewer."));
    error = takeError(error, lengthError(project, 120, "Project must be 120 characters or fewer."));
    error = takeError(error, lengthError(incomingBin, 120, "Incoming bin must be 120 characters or fewer."));
    error = takeError(error, lengthError(search, 500, "The search must be 500 characters or fewer."));

    if (!sku && !search) error = takeError(error, "Enter a SKU or a search.");

    let vendorName = "";
    let vendorId: string | null = null;
    let purchaseOrder = "";
    let purchaseOrderId: string | null = null;
    if (sheetPo) {
      purchaseOrder = sheetPo;
      vendorName = sheetVendor;
    } else if (sheetVendor) {
      vendorName = sheetVendor;
    } else if (defaults.purchaseOrderId.trim()) {
      purchaseOrder = defaults.purchaseOrderNumber.trim();
      purchaseOrderId = defaults.purchaseOrderId.trim();
      vendorName = defaults.vendorName.trim();
    } else if (defaults.vendorId.trim()) {
      vendorId = defaults.vendorId.trim();
      vendorName = defaults.vendorName.trim();
    } else if (defaults.vendorName.trim()) {
      vendorName = defaults.vendorName.trim();
    } else {
      error = takeError(error, CONSIGNED_VENDOR_REQUIRED);
    }

    const units: ReceivingUnitInput[] = [];
    const serials = splitReceivingSerials(serialText);
    const coo = normalizeCooCode(cooText);
    const countryError = cooProblem(cooText);
    if (countryError) error = takeError(error, countryError);
    if ((serials.length > 0 || coo) && !sku) error = takeError(error, "Choose an item before entering serials.");
    const seenHere: string[] = [];
    for (const serial of serials) {
      const problem = serialProblem(serial, sku, seenHere);
      if (problem) {
        error = takeError(error, problem);
        break;
      }
      seenHere.push(serial);
      const batchKey = `${sku.toLowerCase()}\u001f${serial.toLowerCase()}`;
      if (seenAcross.has(batchKey)) {
        error = takeError(error, "That serial is already in this import.");
        break;
      }
      seenAcross.set(batchKey, serial);
      units.push({ serial: normalizeSerial(serial), coo });
    }
    if (serials.length === 0 && coo && !error) units.push({ serial: null, coo });
    if (qty != null && units.length > qty) error = takeError(error, "Enter at most one serial for each piece.");

    const requestId = (requestIds[index] ?? "").trim();
    if (requestId.length > 80) error = takeError(error, "Request id must be 80 characters or fewer.");

    const note = qty != null ? systemQtyMultipleWarning(qty, originQty) : null;
    prepared.push({
      row: rowNumber,
      sku,
      search,
      qty,
      bin,
      vendorName,
      vendorId,
      purchaseOrder,
      purchaseOrderId,
      project,
      receivedOn,
      incomingBin,
      origin,
      originQty,
      comment,
      cleaned: cleanedFlag.ok ? cleanedFlag.value : false,
      wiped: wipedFlag.ok ? wipedFlag.value : false,
      units: error ? [] : units,
      clientRequestId: requestId,
      error,
      note,
    });
  });

  return prepared;
}

export function receivingRpcRows(rows: readonly PreparedReceivingRow[]): ReceivingRpcRow[] {
  return rows
    .filter((row) => row.error == null && row.qty != null)
    .map((row) => ({
      row: row.row,
      sku: row.sku,
      search: row.search,
      qty: row.qty ?? 0,
      bin: row.bin,
      vendor_name: row.purchaseOrderId ? "" : row.vendorName,
      vendor_id: row.purchaseOrderId ? null : row.vendorId,
      purchase_order: row.purchaseOrderId ? "" : row.purchaseOrder,
      purchase_order_id: row.purchaseOrderId,
      project: row.project,
      received_on: row.receivedOn,
      incoming_bin: row.incomingBin,
      origin: row.origin,
      origin_qty: row.originQty,
      comment: row.comment,
      cleaned: row.cleaned,
      wiped: row.wiped,
      units: row.units,
      client_request_id: row.clientRequestId,
    }));
}

export function receivingBatchCanCommit(rows: readonly PreparedReceivingRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.error == null && row.qty != null && row.clientRequestId !== "");
}
