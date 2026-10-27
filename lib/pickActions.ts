"use server";

import { errorText } from "@/lib/errors";
import { pickPageAccess } from "@/lib/pickAccessServer";
import { pickQueueFromJson, pickSheetFromJson, type PickQueueRow, type PickSheetModel } from "@/lib/pickSheet";
import { salesOperatorId } from "@/lib/salesSession";
import { operatorInitials } from "@/lib/stockAccess";
import { getSupabase } from "@/lib/supabase";

const MIGRATION = "supabase/migrations/20261027170000_sales_order_picking.sql";

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

export async function recordPickSerial(pickId: string, serial: string): Promise<PickSheetModel> {
  await assertPicker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("record_pick_serial", {
    p_pick: pickId,
    p_serial: serial,
    p_initials: who.initials,
    p_operator: who.operator,
  });
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
