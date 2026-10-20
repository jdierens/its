import type { DataType } from "@/lib/types";

export const ITEM_PAGE_SIZE = 100;

const TEXT_COLUMNS = new Set([
  "taxonomy",
  "name",
  "item_type",
  "manufacturer",
  "model",
  "part_number",
  "oem_name",
  "oem_part_number",
  "product_url",
  "unit",
  "condition",
  "condition_note",
  "eccn",
  "us_hts",
  "ccats",
  "coo",
]);

const NUMERIC_COLUMNS = new Set(["sku", "quantity", "ecommerce_price", "market_price", "msrp"]);

export type ItemSort = {
  column: string;
  ascending: boolean;
};

export type ItemSortRequest = {
  sort: string;
  attribute: string | null;
  numeric: boolean;
  ascending: boolean;
};

export function isSortableColumn(columnId: string): boolean {
  if (TEXT_COLUMNS.has(columnId) || NUMERIC_COLUMNS.has(columnId) || columnId === "edited") return true;
  return columnId.startsWith("attr:") && columnId.slice(5).trim().length > 0;
}

export function parseItemSort(sort: string | null, dir: string | null): ItemSort {
  const column = sort && isSortableColumn(sort) ? sort : "sku";
  return { column, ascending: dir !== "desc" };
}

export function toggleItemSort(current: ItemSort, columnId: string): ItemSort {
  if (!isSortableColumn(columnId)) return current;
  if (current.column === columnId) return { column: columnId, ascending: !current.ascending };
  return { column: columnId, ascending: true };
}

export function writeItemSort(params: URLSearchParams, sort: ItemSort): void {
  if (sort.column === "sku" && sort.ascending) {
    params.delete("sort");
    params.delete("dir");
  } else {
    params.set("sort", sort.column);
    params.set("dir", sort.ascending ? "asc" : "desc");
  }
  params.delete("page");
}

export function parseItemPage(value: string | null): number {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) return 1;
  return page;
}

export function itemSortRequest(sort: ItemSort, dataType: DataType | null): ItemSortRequest {
  if (sort.column.startsWith("attr:")) {
    const attribute = sort.column.slice(5);
    return {
      sort: "attr",
      attribute,
      numeric: dataType === "integer" || dataType === "decimal",
      ascending: sort.ascending,
    };
  }
  return {
    sort: isSortableColumn(sort.column) ? sort.column : "sku",
    attribute: null,
    numeric: false,
    ascending: sort.ascending,
  };
}
