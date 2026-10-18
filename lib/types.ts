export type DataType = "integer" | "text" | "decimal";

export type Attribute = {
  id: string;
  name: string;
  data_type: DataType;
  unit: string | null;
  uses_list: boolean;
  allowedValues: string[];
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
  attributes: Attribute[];
};

export type ItemSummary = {
  id: string;
  sku: string;
  name: string;
  quantity: number | null;
  taxonomyName: string | null;
  imageUrl: string | null;
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
  url: string | null;
};

export type LabelItem = {
  id: string;
  sku: string;
  name: string;
  description: string;
};
