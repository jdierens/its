export type DataType = "integer" | "text" | "decimal";

export type ListedValue = {
  id: string;
  value: string;
  sortOrder: number;
};

export type Attribute = {
  id: string;
  name: string;
  label: string | null;
  data_type: DataType;
  unit: string | null;
  uses_list: boolean;
  required: boolean;
  sortOrder: number;
  allowedValues: string[];
  values: ListedValue[];
};

export type AttributeDefinition = {
  name: string;
  data_type: DataType;
  unit: string | null;
  uses_list: boolean;
};

export type Taxonomy = {
  id: string;
  name: string;
  longCode: string | null;
  shortCode: string | null;
  sortOrder: number;
  attributes: Attribute[];
};

export type ItemListColumn = {
  name: string;
  unit: string | null;
  dataType: DataType;
  usesList: boolean;
  allowedValues: string[];
};

export type ItemListRow = {
  id: string;
  sku: string;
  name: string;
  itemType: "Product" | "Kit/Package" | "Service" | "Non-inventory";
  quantity: number | null;
  taxonomyName: string | null;
  shortCode: string | null;
  imageUrl: string | null;
  manufacturerId: string | null;
  manufacturerName: string | null;
  model: string;
  partNumber: string;
  oemName: string;
  oemPartNumber: string;
  productUrl: string;
  unit: string;
  condition: string;
  conditionNote: string;
  eccn: string;
  usHts: string;
  ccats: string;
  coo: string;
  ecommercePrice: string | null;
  marketPrice: string | null;
  msrp: string | null;
  updatedAt: string;
  fields: Record<string, string>;
  isGeneric: boolean;
  ebayListings: { ebayItemId: string; packQty: number }[];
  ebayKitListings: { ebayItemId: string; kitItemId: string; kitSku: string; packQty: number; qty: number }[];
};

export type ItemList = {
  rows: ItemListRow[];
  total: number;
  matched: number;
  page: number;
  columns: ItemListColumn[];
  pricing: boolean;
  unknownTax: boolean;
};

export type TaxonomyChoice = {
  name: string;
  shortCode: string;
};

export type ItemDetail = {
  id: string;
  sku: string;
  name: string;
  description: string;
  itemType: "Product" | "Kit/Package" | "Service" | "Non-inventory";
  quantity: number | null;
  taxonomyId: string | null;
  manufacturerId: string | null;
  manufacturerName: string;
  model: string;
  partNumber: string;
  oemName: string;
  oemPartNumber: string;
  productUrl: string;
  unit: string;
  condition: "New" | "Used";
  conditionNote: string;
  eccn: string;
  usHts: string;
  ccats: string;
  coo: string;
  notes: string;
  isGeneric: boolean;
  attributes: Record<string, string>;
  attributeLinks: { id: string; name: string; value: string }[];
};

export type ItemImage = {
  id: string;
  itemId: string;
  storagePath: string;
  sortOrder: number;
  sourceImageId: string | null;
  url: string | null;
};

export type LabelItem = {
  id: string;
  sku: string;
  name: string;
  description: string;
  shortCode: string | null;
  longCode?: string | null;
  taxonomyName?: string | null;
  /** ISO alpha-3 from items.coo, when the lookup selected it. */
  coo?: string | null;
};
