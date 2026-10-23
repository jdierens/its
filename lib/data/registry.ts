export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export type ColumnSpec = {
  key: string;
  required: boolean;
  /** Included in the downloadable template header and sample row. */
  template: boolean;
  export: boolean;
  money: boolean;
  format: string;
  example: string;
  description: string;
  /** Shown on the instructions sheet. Live lists, such as location prefixes, are added at download time. */
  allowed: string[];
  synonyms: string[];
};

export type DataTable = {
  id: string;
  label: string;
  description: string;
  naturalKey: string[];
  policy: "insert" | "upsert";
  importable: boolean;
  exportable: boolean;
  /** Header order for the export file. Falls back to column order. */
  exportOrder?: string[];
  columns: ColumnSpec[];
};

const binCode: ColumnSpec = {
  key: "code",
  required: true,
  template: true,
  export: true,
  money: false,
  format: "^\\d{5}-[BCP]$",
  example: "12345-B",
  description:
    "Five digits, a hyphen, and B, C, or P. A 1–4 digit number is zero-padded. Box, Crate, or Pallet in a Type column supplies a missing suffix.",
  allowed: ["B box", "C crate", "P pallet"],
  synonyms: ["code", "bin", "bin #", "bin code", "bin number", "container", "reference", "ref"],
};

const binLocation: ColumnSpec = {
  key: "location",
  required: false,
  template: true,
  export: true,
  money: false,
  format: "An existing location code",
  example: "HWS.01.02.03",
  description: "Must already exist. A blank cell uses the put-away default for that bin type. Import does not create locations.",
  allowed: [],
  synonyms: ["location", "loc", "shelf", "place", "bin location"],
};

const binNote: ColumnSpec = {
  key: "note",
  required: false,
  template: true,
  export: false,
  money: false,
  format: "Text, up to 2000 characters",
  example: "existing shelf box",
  description: "Stored on the bin as notes. Not printed on the label.",
  allowed: [],
  synonyms: ["note", "notes", "comment", "comments"],
};

const binType: ColumnSpec = {
  key: "type",
  required: false,
  template: false,
  export: true,
  money: false,
  format: "B, C, P, Box, Crate, or Pallet",
  example: "Box",
  description: "Not a template column. Used only when the code column has no suffix.",
  allowed: ["B", "C", "P", "Box", "Crate", "Pallet"],
  synonyms: ["type", "bin type", "suffix", "kind", "container type"],
};

export const BINS_TABLE: DataTable = {
  id: "bins",
  label: "Bins",
  description: "Register boxes, crates, and pallets that already have codes. Existing codes are skipped.",
  naturalKey: ["code"],
  policy: "insert",
  importable: true,
  exportable: true,
  exportOrder: [
    "code",
    "type",
    "location",
    "project",
    "origin",
    "qty",
    "created_at",
    "created_by_initials",
    "printed_count",
    "last_printed_at",
  ],
  columns: [
    binCode,
    binLocation,
    binNote,
    binType,
    exportOnly("project", "Open cycle project", ""),
    exportOnly("origin", "Open cycle origin", ""),
    exportOnly("qty", "Quantity in the open cycle", "0"),
    exportOnly("created_at", "When the bin was created", ""),
    exportOnly("created_by_initials", "Initials recorded at creation", ""),
    exportOnly("printed_count", "Times the label was printed", "0"),
    exportOnly("last_printed_at", "When the label was last printed", ""),
  ],
};

function exportOnly(key: string, description: string, example: string): ColumnSpec {
  return {
    key,
    required: false,
    template: false,
    export: true,
    money: false,
    format: "",
    example,
    description,
    allowed: [],
    synonyms: [],
  };
}

export const LOCATIONS_TABLE: DataTable = {
  id: "locations",
  label: "Locations",
  description: "Export place codes. Import can be added later.",
  naturalKey: ["code"],
  policy: "insert",
  importable: false,
  exportable: true,
  columns: [
    {
      key: "code",
      required: true,
      template: true,
      export: true,
      money: false,
      format: "Location code",
      example: "HWS.01.02.03",
      description: "The place code.",
      allowed: [],
      synonyms: ["code", "location"],
    },
    {
      key: "type",
      required: true,
      template: true,
      export: true,
      money: false,
      format: "Location type name",
      example: "Henderson Warehouse Shelves",
      description: "The location type name.",
      allowed: [],
      synonyms: ["type", "name"],
    },
    {
      key: "prefix",
      required: true,
      template: true,
      export: true,
      money: false,
      format: "Location type prefix",
      example: "HWS",
      description: "The prefix registered on the location type.",
      allowed: [],
      synonyms: ["prefix"],
    },
    {
      key: "row",
      required: false,
      template: true,
      export: true,
      money: false,
      format: "Two digits",
      example: "01",
      description: "Shelf or rack row.",
      allowed: [],
      synonyms: ["row"],
    },
    {
      key: "bay",
      required: false,
      template: true,
      export: true,
      money: false,
      format: "Two digits",
      example: "02",
      description: "Bay.",
      allowed: [],
      synonyms: ["bay"],
    },
    {
      key: "elevation",
      required: false,
      template: true,
      export: true,
      money: false,
      format: "Two digits",
      example: "03",
      description: "Elevation.",
      allowed: [],
      synonyms: ["elevation"],
    },
    {
      key: "orientation",
      required: false,
      template: true,
      export: true,
      money: false,
      format: "N, S, E, W, or C",
      example: "",
      description: "Racking orientation when the code has one.",
      allowed: ["N", "S", "E", "W", "C"],
      synonyms: ["orientation"],
    },
    {
      key: "description",
      required: false,
      template: true,
      export: true,
      money: false,
      format: "Text",
      example: "Henderson Warehouse Shelves",
      description: "Free description.",
      allowed: [],
      synonyms: ["description"],
    },
  ],
};

export const DATA_TABLES: DataTable[] = [BINS_TABLE, LOCATIONS_TABLE];

export function dataTable(id: string): DataTable | undefined {
  return DATA_TABLES.find((table) => table.id === id);
}

export function templateColumns(table: DataTable): ColumnSpec[] {
  return table.columns.filter((column) => column.template);
}

/** Columns the mapping step can attach to a source header. Export-only fields are left out. */
export function mappingColumns(table: DataTable): ColumnSpec[] {
  return table.columns.filter((column) => column.template || column.synonyms.length > 0);
}

export function exportColumns(table: DataTable, canViewMoney: boolean): ColumnSpec[] {
  const columns = table.columns.filter((column) => column.export && (canViewMoney || !column.money));
  if (!table.exportOrder) return columns;
  const byKey = new Map(columns.map((column) => [column.key, column]));
  return table.exportOrder.flatMap((key) => {
    const column = byKey.get(key);
    return column ? [column] : [];
  });
}

export function importSizeError(bytes: number, rows: number): string | null {
  if (bytes > MAX_IMPORT_BYTES) return "That file is larger than 2 MB.";
  if (rows > MAX_IMPORT_ROWS) return "Import at most 5000 rows at a time.";
  return null;
}
