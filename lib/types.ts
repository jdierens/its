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
};

export type ItemListRow = {
  id: string;
  sku: string;
  name: string;
  quantity: number | null;
  taxonomyName: string | null;
  shortCode: string | null;
  imageUrl: string | null;
  fields: Record<string, string>;
};

export type ItemList = {
  rows: ItemListRow[];
  total: number;
  columns: ItemListColumn[];
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
  quantity: number | null;
  taxonomyId: string | null;
  attributes: Record<string, string>;
};

export type ItemImage = {
  id: string;
  itemId: string;
  storagePath: string;
  isPrimary: boolean;
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
};
