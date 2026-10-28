"use server";

import { errorText } from "@/lib/errors";
import { pickPageAccess } from "@/lib/pickAccessServer";
import {
  escapeIlike,
  resolveSerialPull,
  serialPullLines,
  type KnownSerialUnit,
  type SerialPull,
} from "@/lib/pickSerialLocation";
import { pickQueueFromJson, pickSheetFromJson, type PickQueueRow, type PickSheetModel } from "@/lib/pickSheet";
import { salesOperatorId } from "@/lib/salesSession";
import { operatorInitials } from "@/lib/stockAccess";
import { getSupabase } from "@/lib/supabase";

const MIGRATION = "supabase/migrations/20261027170000_sales_order_picking.sql";
const STOCK_UNITS_MIGRATION = "supabase/migrations/20261027230000_stock_units.sql";
const REPLACEMENT_MIGRATION = "supabase/migrations/20261028073000_so_sku_replacement.sql";

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

export async function recordPickSerial(pickId: string, serial: string, coo?: string | null): Promise<PickSheetModel> {
  await assertPicker();
  const who = await actor();
  const country = coo?.trim() || null;
  const supabase = await getSupabase();
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
 */
export async function lookupPickSerial(
  orderId: string,
  serial: string,
  allocationId?: string | null,
): Promise<SerialPull> {
  await assertPicker();
  const sheet = await readPickSheet(orderId);
  const supabase = await getSupabase();
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

  const orderSkus = new Set(sheet.lines.map((line) => line.sku.trim().toLowerCase()));
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
    lines: serialPullLines(sheet.lines),
    allocationId,
  });
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.pull;
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
