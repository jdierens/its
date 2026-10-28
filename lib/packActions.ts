"use server";

import { errorText } from "@/lib/errors";
import { packPageAccess } from "@/lib/packAccessServer";
import {
  packagingTypeError,
  packagingTypeMeasures,
  packagingTypesFromJson,
  packQueueFromJson,
  packSheetFromJson,
  parseInches,
  parsePackWeight,
  shipQueueFromJson,
  type PackagingType,
  type PackQueueRow,
  type PackSheetModel,
  type ShipQueueRow,
} from "@/lib/packSheet";
import { salesOperatorId } from "@/lib/salesSession";
import { operatorInitials } from "@/lib/stockAccess";
import { getSupabase } from "@/lib/supabase";

const MIGRATION = "supabase/migrations/20261028233000_sales_order_packing.sql";

function raisePack(error: { code?: string; message?: string } | null): never {
  if (error && (error.code === "PGRST202" || /could not find the function|schema cache/i.test(error.message ?? ""))) {
    throw new Error(`Apply ${MIGRATION} before packing can be saved.`);
  }
  throw new Error(errorText(error));
}

async function assertPacker(): Promise<void> {
  const access = await packPageAccess();
  if (!access.canPack) throw new Error("You cannot pack this order.");
}

async function actor(): Promise<{ initials: string; operator: string | null }> {
  return { initials: await operatorInitials(), operator: await salesOperatorId() };
}

function sheet(data: unknown): PackSheetModel {
  return packSheetFromJson(data);
}

export async function loadPackQueue(): Promise<PackQueueRow[]> {
  const { data, error } = await (await getSupabase()).rpc("list_pack_queue");
  if (error) raisePack(error);
  return packQueueFromJson(data);
}

export async function loadShipQueue(): Promise<ShipQueueRow[]> {
  const { data, error } = await (await getSupabase()).rpc("list_ship_queue");
  if (error) raisePack(error);
  return shipQueueFromJson(data);
}

export async function readPackSheet(orderId: string): Promise<PackSheetModel> {
  const { data, error } = await (await getSupabase()).rpc("sales_order_pack_sheet", { p_order: orderId });
  if (error) raisePack(error);
  return sheet(data);
}

export async function openPackSheet(orderId: string): Promise<PackSheetModel> {
  await assertPacker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("open_sales_order_pack", {
    p_order: orderId,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePack(error);
  return sheet(data);
}

export async function addPackagingType(input: {
  name: string;
  kind: string;
  length: string;
  width: string;
  height: string;
}): Promise<PackagingType[]> {
  await assertPacker();
  const problem = packagingTypeError(input);
  if (problem) throw new Error(problem);
  const measures = packagingTypeMeasures(input);
  if (!measures) throw new Error("Check the packaging dimensions.");
  const { data, error } = await (await getSupabase()).rpc("add_packaging_type", {
    p_name: input.name.trim(),
    p_kind: input.kind,
    p_length: measures.lengthIn,
    p_width: measures.widthIn,
    p_height: measures.heightIn,
  });
  if (error) raisePack(error);
  return packagingTypesFromJson(data);
}

export async function retirePackagingType(typeId: string): Promise<PackagingType[]> {
  await assertPacker();
  const { data, error } = await (await getSupabase()).rpc("retire_packaging_type", { p_type: typeId });
  if (error) raisePack(error);
  return packagingTypesFromJson(data);
}

export async function addShippingBin(input: {
  orderId: string;
  typeId: string;
  height: string | null;
}): Promise<PackSheetModel> {
  await assertPacker();
  const who = await actor();
  let height: number | null = null;
  if (input.height != null) {
    const parsed = parseInches(input.height, "the pallet height");
    if (!parsed.ok) throw new Error(parsed.message);
    height = parsed.inches;
  }
  const { data, error } = await (await getSupabase()).rpc("add_shipping_bin", {
    p_order: input.orderId,
    p_type: input.typeId,
    p_height: height,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePack(error);
  return sheet(data);
}

export async function removeShippingBin(packageId: string): Promise<PackSheetModel> {
  await assertPacker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("remove_shipping_bin", {
    p_package: packageId,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePack(error);
  return sheet(data);
}

export async function setShippingBinWeight(packageId: string, weight: number): Promise<PackSheetModel> {
  await assertPacker();
  const parsed = parsePackWeight(String(weight));
  if (!parsed.ok) throw new Error(parsed.message);
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("set_shipping_bin_weight", {
    p_package: packageId,
    p_weight: parsed.weight,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePack(error);
  return sheet(data);
}

export async function setShippingBinHeight(packageId: string, height: number): Promise<PackSheetModel> {
  await assertPacker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("set_shipping_bin_height", {
    p_package: packageId,
    p_height: height,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePack(error);
  return sheet(data);
}

export async function assignPackQty(input: {
  packageId: string;
  allocationId: string;
  qty: number;
}): Promise<PackSheetModel> {
  await assertPacker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("assign_pack_qty", {
    p_package: input.packageId,
    p_allocation: input.allocationId,
    p_qty: input.qty,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePack(error);
  return sheet(data);
}

export async function removePackAssignment(contentId: string): Promise<PackSheetModel> {
  await assertPacker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("remove_pack_assignment", {
    p_content: contentId,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePack(error);
  return sheet(data);
}

export async function finishPack(orderId: string): Promise<PackSheetModel> {
  await assertPacker();
  const who = await actor();
  const { data, error } = await (await getSupabase()).rpc("finish_sales_order_pack", {
    p_order: orderId,
    p_initials: who.initials,
    p_operator: who.operator,
  });
  if (error) raisePack(error);
  return sheet(data);
}
