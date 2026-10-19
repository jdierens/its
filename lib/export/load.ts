import { errorText } from "@/lib/errors";
import {
  moneyCell,
  PRICING_FIELDS,
  timestampCell,
  type ExportAttribute,
  type ExportItem,
  type PricingKey,
} from "@/lib/export/table";
import { primaryStoragePath } from "@/lib/imageOrder";
import { resolveItemQuery } from "@/lib/items";
import { getSupabase } from "@/lib/supabase";

const PAGE = 1000;
const ID_CHUNK = 150;

const DETAIL_COLUMNS = [
  "id",
  "sku",
  "model",
  "part_number",
  "condition",
  "condition_note",
  "eccn",
  "us_hts",
  "ccats",
  "coo",
  "created_at",
  "updated_at",
  "manufacturers(name)",
  "taxonomies(short_code, name, sort_order, taxonomy_attributes(sort_order, attributes(name)))",
  "item_images(storage_path, sort_order)",
  "item_attributes(value, attributes(name))",
].join(", ");

type Named = { name: string | null };
type TaxLink = {
  sort_order: number | null;
  attributes: Named | Named[] | null;
};
type TaxRow = {
  short_code: string | null;
  name: string | null;
  sort_order: number | null;
  taxonomy_attributes: TaxLink[] | null;
};
type FieldRow = {
  value: string | null;
  attributes: Named | Named[] | null;
};
type ImageRow = {
  storage_path: string;
  sort_order: number;
};
type ExportRow = {
  id: string;
  sku: string | null;
  model: string | null;
  part_number: string | null;
  condition: string | null;
  condition_note: string | null;
  eccn: string | null;
  us_hts: string | null;
  ccats: string | null;
  coo: string | null;
  created_at: string | null;
  updated_at: string | null;
  ecommerce_price?: unknown;
  market_price?: unknown;
  msrp?: unknown;
  pricing_checked_at?: unknown;
  manufacturers: Named | Named[] | null;
  taxonomies: TaxRow | TaxRow[] | null;
  item_images: ImageRow[] | null;
  item_attributes: FieldRow[] | null;
};

type ItemFilter = {
  taxonomyId: string | null;
  condition: "" | "New" | "Used";
  manufacturerId: string | null;
  ids: string[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

async function presentPricingKeys(): Promise<PricingKey[]> {
  const keys = PRICING_FIELDS.map((field) => field.key);
  const probe = await getSupabase().from("items").select(keys.join(",")).limit(1);
  if (probe.error) return [];
  return [...keys];
}

async function selectRows(columns: string, filter: ItemFilter): Promise<ExportRow[]> {
  const supabase = getSupabase();
  const records: ExportRow[] = [];
  const groups = filter.ids && filter.ids.length > ID_CHUNK
    ? Array.from({ length: Math.ceil(filter.ids.length / ID_CHUNK) }, (_, index) =>
        filter.ids!.slice(index * ID_CHUNK, (index + 1) * ID_CHUNK),
      )
    : [filter.ids];

  for (const ids of groups) {
    let from = 0;
    for (;;) {
      let query = supabase.from("items").select(columns).order("sku", { ascending: true });
      if (filter.taxonomyId) query = query.eq("taxonomy_id", filter.taxonomyId);
      if (filter.condition) query = query.eq("condition", filter.condition);
      if (filter.manufacturerId) query = query.eq("manufacturer_id", filter.manufacturerId);
      if (ids) query = query.in("id", ids);
      const listed = await query.range(from, from + PAGE - 1);
      if (listed.error) throw new Error(errorText(listed.error));
      const rows = (listed.data ?? []) as unknown as ExportRow[];
      records.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }

  records.sort((a, b) => (a.sku ?? "").localeCompare(b.sku ?? "", undefined, { numeric: true }));
  return records;
}

function toExportItem(row: ExportRow, pricingKeys: readonly PricingKey[], origin: string): ExportItem {
  const taxonomy = one(row.taxonomies);
  const shortCode = text(taxonomy?.short_code).toUpperCase();
  const links = taxonomy?.taxonomy_attributes ?? [];
  const taxonomySort = taxonomy?.sort_order ?? Number.MAX_SAFE_INTEGER;
  const attributeOrder: ExportAttribute[] = links.flatMap((link) => {
    const attribute = one(link.attributes);
    const name = text(attribute?.name);
    if (!name) return [];
    return [{ name, taxonomySort, sort: link.sort_order ?? 0 }];
  });

  const attributes: Record<string, string> = {};
  for (const field of row.item_attributes ?? []) {
    const name = text(one(field.attributes)?.name);
    if (!name || attributes[name]) continue;
    attributes[name] = field.value ?? "";
  }

  const path = primaryStoragePath(row.item_images);
  const prices: ExportItem["prices"] = {};
  if (pricingKeys.includes("ecommerce_price")) prices.ecommerce_price = moneyCell(row.ecommerce_price);
  if (pricingKeys.includes("market_price")) prices.market_price = moneyCell(row.market_price);
  if (pricingKeys.includes("msrp")) prices.msrp = moneyCell(row.msrp);
  if (pricingKeys.includes("pricing_checked_at")) {
    prices.pricing_checked_at = timestampCell(row.pricing_checked_at);
  }

  return {
    sku: text(row.sku),
    taxonomy: shortCode || text(taxonomy?.name),
    manufacturer: text(one(row.manufacturers)?.name),
    model: text(row.model),
    partNumber: text(row.part_number),
    condition: text(row.condition),
    conditionNote: text(row.condition_note),
    eccn: text(row.eccn),
    usHts: text(row.us_hts),
    ccats: text(row.ccats),
    coo: text(row.coo),
    prices,
    primaryImageUrl: path ? `${origin}/api/items/${row.id}/primary-image` : "",
    createdAt: timestampCell(row.created_at),
    updatedAt: timestampCell(row.updated_at),
    attributes,
    attributeOrder,
  };
}

export async function loadExportItems(input: {
  scope: "view" | "all";
  tax?: string;
  q?: string;
  condition?: string;
  manufacturerId?: string;
  origin: string;
}): Promise<{ items: ExportItem[]; pricingKeys: PricingKey[]; unknownTax: boolean }> {
  const pricingKeys = await presentPricingKeys();
  const columns = pricingKeys.length === 0 ? DETAIL_COLUMNS : `${DETAIL_COLUMNS}, ${pricingKeys.join(", ")}`;
  const origin = input.origin.replace(/\/$/, "");

  if (input.scope === "all") {
    const rows = await selectRows(columns, {
      taxonomyId: null,
      condition: "",
      manufacturerId: null,
      ids: null,
    });
    return { items: rows.map((row) => toExportItem(row, pricingKeys, origin)), pricingKeys, unknownTax: false };
  }

  const resolved = await resolveItemQuery(input);
  if (resolved.unknownTax || resolved.empty) {
    return { items: [], pricingKeys, unknownTax: resolved.unknownTax };
  }

  const rows = await selectRows(columns, {
    taxonomyId: resolved.taxonomyId,
    condition: resolved.condition,
    manufacturerId: resolved.manufacturerId,
    ids: resolved.ids,
  });
  return { items: rows.map((row) => toExportItem(row, pricingKeys, origin)), pricingKeys, unknownTax: false };
}
