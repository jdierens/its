"use server";

import { CONSIGNED_RECEIVE_MIGRATION } from "@/lib/consignedReceive";
import { importSizeError } from "@/lib/data/registry";
import { errorText } from "@/lib/errors";
import {
  prepareReceivingImport,
  receivingBatchCanCommit,
  receivingRpcRows,
  RECEIVING_IMPORT_MIGRATION,
  type PreparedReceivingRow,
  type ReceivingImportDefaults,
} from "@/lib/receivingImport";
import { warehouseToday } from "@/lib/receivingSettings";
import { operatorInitials } from "@/lib/stockAccess";
import { getSupabase } from "@/lib/supabase";

export type ReceivingImportPreviewRow = {
  row: number;
  sku: string;
  search: string;
  qty: number | null;
  bin: string;
  vendor: string;
  purchaseOrder: string;
  status: "ok" | "error";
  message: string;
};

export type ReceivingImportPreview = {
  rows: ReceivingImportPreviewRow[];
  requestIds: string[];
};

export type ReceivingImportResult = {
  committed: boolean;
  rows: ReceivingImportPreviewRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function missingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42P01" || error.code === "42883";
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function previewFromPrepared(row: PreparedReceivingRow): ReceivingImportPreviewRow {
  return {
    row: row.row,
    sku: row.sku,
    search: row.search,
    qty: row.qty,
    bin: row.bin,
    vendor: row.vendorName,
    purchaseOrder: row.purchaseOrder,
    status: row.error ? "error" : "ok",
    message: row.error ?? row.note ?? "",
  };
}

function sqlRows(value: unknown): ReceivingImportPreviewRow[] {
  if (!isRecord(value) || !Array.isArray(value.rows)) return [];
  return value.rows.filter(isRecord).map((row) => ({
    row: Number(row.row),
    sku: text(row.sku),
    search: text(row.search),
    qty: row.qty == null || row.qty === "" ? null : Number(row.qty),
    bin: text(row.bin),
    vendor: text(row.vendor),
    purchaseOrder: text(row.purchase_order),
    status: row.status === "ok" ? "ok" : "error",
    message: text(row.message),
  }));
}

function mergeRows(prepared: readonly PreparedReceivingRow[], checked: readonly ReceivingImportPreviewRow[]): ReceivingImportPreviewRow[] {
  const byRow = new Map(checked.map((row) => [row.row, row]));
  return prepared.map((row) => {
    if (row.error) return previewFromPrepared(row);
    const sql = byRow.get(row.row);
    if (!sql) {
      return { ...previewFromPrepared(row), status: "error", message: "That row could not be checked." };
    }
    const note = sql.status === "ok" ? row.note : null;
    return {
      ...sql,
      sku: sql.sku || row.sku,
      search: sql.search || row.search,
      qty: sql.qty ?? row.qty,
      bin: sql.bin || row.bin,
      vendor: sql.vendor || row.vendorName,
      purchaseOrder: sql.purchaseOrder || row.purchaseOrder,
      message: [sql.message, note].filter(Boolean).join(" "),
    };
  });
}

function withRequestIds(records: readonly Record<string, string>[], requestIds: readonly string[] | undefined): string[] {
  return records.map((_, index) => {
    const given = (requestIds?.[index] ?? "").trim();
    return given || crypto.randomUUID();
  });
}

function migrationError(): Error {
  return new Error(
    `Apply ${RECEIVING_IMPORT_MIGRATION} after ${CONSIGNED_RECEIVE_MIGRATION} before importing receipts. The import posts each row through receive_into_bin.`,
  );
}

async function classify(
  records: readonly Record<string, string>[],
  defaults: ReceivingImportDefaults,
  requestIds: readonly string[] | undefined,
  dryRun: boolean,
): Promise<{ prepared: PreparedReceivingRow[]; requestIds: string[]; rows: ReceivingImportPreviewRow[]; committed: boolean }> {
  const size = importSizeError(0, records.length);
  if (size) throw new Error(size);
  const ids = withRequestIds(records, requestIds);
  const prepared = prepareReceivingImport(records, defaults, ids, warehouseToday());
  if (prepared.length === 0) throw new Error("That file has no data rows.");
  const localErrors = prepared.some((row) => row.error);
  if (!dryRun && (!receivingBatchCanCommit(prepared) || localErrors)) {
    return { prepared, requestIds: ids, rows: prepared.map(previewFromPrepared), committed: false };
  }
  const payload = receivingRpcRows(prepared);
  if (payload.length === 0) {
    return { prepared, requestIds: ids, rows: prepared.map(previewFromPrepared), committed: false };
  }
  const initials = await operatorInitials();
  const { data, error } = await (await getSupabase()).rpc("import_receiving_rows", {
    p_rows: payload,
    p_initials: initials,
    p_dry_run: dryRun || localErrors,
  });
  if (error && missingSchema(error)) throw migrationError();
  if (error) throw new Error(errorText(error));
  const body = isRecord(data) ? data : {};
  const rows = mergeRows(prepared, sqlRows(body));
  const committed = !dryRun && !localErrors && body.committed === true && rows.every((row) => row.status === "ok");
  return { prepared, requestIds: ids, rows, committed };
}

export async function previewReceivingImport(input: {
  rows: Record<string, string>[];
  defaults: ReceivingImportDefaults;
  requestIds?: string[];
}): Promise<ReceivingImportPreview> {
  const checked = await classify(input.rows ?? [], input.defaults, input.requestIds, true);
  return { rows: checked.rows, requestIds: checked.requestIds };
}

export async function commitReceivingImport(input: {
  rows: Record<string, string>[];
  defaults: ReceivingImportDefaults;
  requestIds: string[];
}): Promise<ReceivingImportResult> {
  const checked = await classify(input.rows ?? [], input.defaults, input.requestIds, false);
  return { committed: checked.committed, rows: checked.rows };
}
