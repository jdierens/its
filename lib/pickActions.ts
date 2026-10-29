"use server";

import { unstable_rethrow } from "next/navigation";
import { errorText } from "@/lib/errors";
import { pickPageAccess } from "@/lib/pickAccessServer";
import {
  escapeIlike,
  resolveSerialPull,
  serialPullLines,
  type KnownSerialUnit,
  type SerialPull,
} from "@/lib/pickSerialLocation";
import { applyPastedSerials, type SerialPasteReport } from "@/lib/pickSerialPaste";
import { itemSerials, pickQueueFromJson, pickSheetFromJson, type PickQueueRow, type PickSheetModel } from "@/lib/pickSheet";
import { salesOperatorId } from "@/lib/salesSession";
import { operatorInitials } from "@/lib/stockAccess";
import { cooProblem } from "@/lib/stockUnits";
import { getSupabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PickResult<T> = { ok: true; value: T } | { ok: false; message: string };

function pickFailure(error: unknown): PickResult<never> {
  return { ok: false, message: errorText(error) };
}

const MIGRATION = "supabase/migrations/20261027170000_sales_order_picking.sql";
const STOCK_UNITS_MIGRATION = "supabase/migrations/20261027230000_stock_units.sql";
const REPLACEMENT_MIGRATION = "supabase/migrations/20261028073000_so_sku_replacement.sql";
const STAGING_MIGRATION = "supabase/migrations/20261028183000_pick_staging_choice.sql";

function raisePick(error: { code?: string; message?: string } | null): never {
  if (error && (error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message ?? ""))) {
    throw new Error(`Apply ${MIGRATION} before picks can be saved.`);
  }
  throw new Error(errorText(error));
}

async function assertPicker(): Promise<void> {
  const access = await pickPageAccess();
  if (!access.canPick) throw new Error("You cannot record picks.");
}

async function actor(): Promise<{ initials: string; operator: string | null }> {
  return { initials: await operatorInitials(), operator: await salesOperatorId() };
}

function sheet(data: unknown): PickSheetModel {
  return pickSheetFromJson(data);
}

export async function loadPickQueue(): Promise<PickQueueRow[]> {
  const { data, error } = await (await getSupabase()).rpc("list_pick_queue");
  if (error) raisePick(error);
  return pickQueueFromJson(data);
}

export async function readPickSheet(orderId: string): Promise<PickSheetModel> {
  const { data, error } = await (await getSupabase()).rpc("sales_order_pick_sheet", { p_order: orderId });
  if (error) raisePick(error);
  return sheet(data);
}

export async function openPickSheet(orderId: string): Promise<PickSheetModel> {
  await assertPicker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("open_sales_order_pick", {
    p_order: orderId,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePick(error);
  return sheet(data);
}

export async function setPickReplacement(input: {
  allocationId: string;
  actualItemId: string | null;
  reason: string;
}): Promise<PickSheetModel> {
  await assertPicker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("set_so_allocation_replacement", {
    p_allocation: input.allocationId,
    p_actual: input.actualItemId,
    p_reason: input.reason,
    p_initials: who.initials,
    p_operator: who.operator,
    p_context: "pick",
  });
  if (error && (error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message ?? ""))) {
    throw new Error(`Apply ${REPLACEMENT_MIGRATION} before a replacement SKU can be saved.`);
  }
  if (error) raisePick(error);
  return sheet(data);
}

export async function assignPickStagingBin(orderId: string, reference: string): Promise<PickSheetModel> {
  await assertPicker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("assign_pick_staging_bin", {
    p_order: orderId,
    p_reference: reference,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error && (error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message ?? ""))) {
    throw new Error(`Apply ${STAGING_MIGRATION} before a staging bin can be chosen.`);
  }
  if (error) raisePick(error);
  return sheet(data);
}

export async function recordPick(input: {
  orderId: string;
  allocationId: string;
  binId: string;
  qty: number;
  requestId: string;
}): Promise<PickSheetModel> {
  await assertPicker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("pick_sales_order_line", {
    p_order: input.orderId,
    p_allocation: input.allocationId,
    p_from: input.binId,
    p_qty: input.qty,
    p_initials: who.initials,
    p_operator: who.operator,
    p_request: input.requestId,
  });
  if (error) raisePick(error);
  return sheet(data);
}

async function attachPickSerial(
  supabase: SupabaseClient,
  pickId: string,
  serial: string,
  coo: string | null | undefined,
  who: { initials: string; operator: string | null },
): Promise<PickSheetModel> {
  const country = coo?.trim() || null;
  const payload = {
    p_pick: pickId,
    p_serial: serial,
    p_initials: who.initials,
    p_operator: who.operator,
    p_coo: country,
  };
  let { data, error } = await supabase.rpc("record_pick_serial", payload);
  if (error && (error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message ?? ""))) {
    if (country) throw new Error(`Apply ${STOCK_UNITS_MIGRATION} before a country of origin can be saved.`);
    const { p_coo: _country, ...withoutCountry } = payload;
    ({ data, error } = await supabase.rpc("record_pick_serial", withoutCountry));
  }
  if (error) raisePick(error);
  return sheet(data);
}

export async function recordPickSerial(
  pickId: string,
  serial: string,
  coo?: string | null,
): Promise<PickResult<PickSheetModel>> {
  try {
    await assertPicker();
    return { ok: true, value: await attachPickSerial(await getSupabase(), pickId, serial, coo, await actor()) };
  } catch (error) {
    unstable_rethrow(error);
    return pickFailure(error);
  }
}

export async function removePickSerial(unitId: string): Promise<PickSheetModel> {
  await assertPicker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("remove_pick_serial", {
    p_unit: unitId,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePick(error);
  return sheet(data);
}

export async function setPickShort(orderId: string, allocationId: string, short: boolean): Promise<PickSheetModel> {
  await assertPicker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("set_pick_short", {
    p_order: orderId,
    p_allocation: allocationId,
    p_short: short,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePick(error);
  return sheet(data);
}

export async function undoPick(pickId: string): Promise<PickSheetModel> {
  await assertPicker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("undo_sales_order_pick", {
    p_pick: pickId,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePick(error);
  return sheet(data);
}

type StockUnitRow = {
  item_id: string;
  serial_number: string | null;
  status: string;
  bin_id: string | null;
  country_of_origin: string | null;
};

function stockUnitsMissing(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /stock_units|could not find the table|schema cache/i.test(error.message ?? "")
  );
}

/**
 * Resolves a scanned serial to the bin it is in now. The location is only
 * returned when the unit is on this order and still in an open pick bin.
 * Expected failures are returned. A thrown error would be omitted in production.
 */
export async function lookupPickSerial(
  orderId: string,
  serial: string,
  allocationId?: string | null,
): Promise<PickResult<SerialPull>> {
  try {
    await assertPicker();
    const pull = await serialPullForSheet(await getSupabase(), await readPickSheet(orderId), serial, allocationId);
    return { ok: true, value: pull };
  } catch (error) {
    unstable_rethrow(error);
    return pickFailure(error);
  }
}

async function serialPullForSheet(
  supabase: SupabaseClient,
  pickSheet: PickSheetModel,
  serial: string,
  allocationId?: string | null,
): Promise<SerialPull> {
  const { data, error } = await supabase
    .from("stock_units")
    .select("item_id, serial_number, status, bin_id, country_of_origin")
    .ilike("serial_number", escapeIlike(serial.trim()));
  if (error) {
    if (stockUnitsMissing(error)) {
      throw new Error(`Apply ${STOCK_UNITS_MIGRATION} before a serial can fill a location.`);
    }
    throw new Error(errorText(error));
  }

  const rows = ((data ?? []) as StockUnitRow[]).filter(
    (row) => (row.serial_number ?? "").trim().toLowerCase() === serial.trim().toLowerCase(),
  );
  const itemIds = [...new Set(rows.map((row) => row.item_id))];
  const binIds = [...new Set(rows.map((row) => row.bin_id).filter((id): id is string => Boolean(id)))];

  const skuById = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: items, error: itemError } = await supabase.from("items").select("id, sku").in("id", itemIds);
    if (itemError) throw new Error(errorText(itemError));
    for (const item of (items ?? []) as { id: string; sku: string | null }[]) {
      skuById.set(item.id, item.sku ?? "");
    }
  }

  const referenceById = new Map<string, { reference: string; locationId: string | null }>();
  if (binIds.length > 0) {
    const { data: bins, error: binError } = await supabase
      .from("bins")
      .select("id, reference, current_location_id")
      .in("id", binIds);
    if (binError) throw new Error(errorText(binError));
    for (const bin of (bins ?? []) as { id: string; reference: string; current_location_id: string | null }[]) {
      referenceById.set(bin.id, { reference: bin.reference, locationId: bin.current_location_id });
    }
  }

  const locationById = new Map<string, string>();
  const locationIds = [...new Set([...referenceById.values()].map((bin) => bin.locationId).filter((id): id is string => Boolean(id)))];
  if (locationIds.length > 0) {
    const { data: locations, error: locationError } = await supabase.from("locations").select("id, code").in("id", locationIds);
    if (locationError) throw new Error(errorText(locationError));
    for (const location of (locations ?? []) as { id: string; code: string }[]) {
      locationById.set(location.id, location.code);
    }
  }

  const orderSkus = new Set(pickSheet.lines.map((line) => line.sku.trim().toLowerCase()));
  const units: KnownSerialUnit[] = rows.map((row) => {
    const sku = skuById.get(row.item_id) ?? "";
    const bin = row.bin_id ? referenceById.get(row.bin_id) : undefined;
    const location = bin?.locationId ? locationById.get(bin.locationId) ?? null : null;
    return {
      serial: (row.serial_number ?? "").trim(),
      sku,
      onOrder: orderSkus.has(sku.trim().toLowerCase()),
      status: row.status,
      binId: row.bin_id,
      reference: bin?.reference ?? null,
      location,
      coo: row.country_of_origin,
    };
  });

  const resolved = resolveSerialPull({
    serial,
    units,
    lines: serialPullLines(pickSheet.lines),
    allocationId,
  });
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.pull;
}

/**
 * Applies a spreadsheet column in one action.
 * Each serial is looked up and attached here, and a business failure is returned
 * on that serial. Throwing once per serial is omitted in production and shows up
 * as a Server Components digest for every line in the paste.
 */
export async function pastePickSerials(input: {
  orderId: string;
  allocationId: string;
  serials: readonly string[];
  coo: string;
}): Promise<{ sheet: PickSheetModel | null; report: SerialPasteReport }> {
  const serials = (Array.isArray(input.serials) ? input.serials : []).filter((serial): serial is string => typeof serial === "string");
  const coo = typeof input.coo === "string" ? input.coo : "";
  try {
    await assertPicker();
    const who = await actor();
    const supabase = await getSupabase();
    let current = await readPickSheet(input.orderId);
    const country = cooProblem(coo);
    if (country) return { sheet: current, report: refusedSerials(serials, country) };
    const line = current.lines.find((row) => row.allocationId === input.allocationId);
    if (!line) return { sheet: current, report: refusedSerials(serials, "That line is not on this pick.") };
    const sku = line.sku;
    const allocationId = input.allocationId;
    const report = await applyPastedSerials({
      serials,
      sku,
      coo,
      existing: () => itemSerials(current, sku),
      picks: () => current.lines.find((row) => row.allocationId === allocationId)?.picks ?? [],
      lookup: (serial) => serialPullForSheet(supabase, current, serial, allocationId),
      record: async (pickId, serial, countryOfOrigin) => {
        current = await attachPickSerial(supabase, pickId, serial, countryOfOrigin, who);
      },
    });
    return { sheet: current, report };
  } catch (error) {
    unstable_rethrow(error);
    console.error(error);
    return { sheet: null, report: refusedSerials(serials, errorText(error)) };
  }
}

function refusedSerials(serials: readonly string[], message: string): SerialPasteReport {
  return {
    accepted: 0,
    failures: serials.map((serial) => ({ serial: serial.trim() || serial, message })),
  };
}

export async function finishPick(orderId: string): Promise<PickSheetModel> {
  await assertPicker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("finish_sales_order_pick", {
    p_order: orderId,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePick(error);
  return sheet(data);
}
