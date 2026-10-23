import { instructionRows, templateSheetRows } from "@/lib/data/csv";
import { loadXlsx } from "@/lib/data/parseTable";
import { templateColumns, type DataTable } from "@/lib/data/registry";

function asBytes(value: Uint8Array | number[] | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

/** Workbook from the same column spec the importer validates against. */
export async function templateWorkbook(
  table: DataTable,
  extraAllowed: Record<string, string[]> = {},
): Promise<Uint8Array> {
  const XLSX = await loadXlsx();
  if (!XLSX.utils.book_new || !XLSX.utils.aoa_to_sheet || !XLSX.utils.book_append_sheet || !XLSX.write) {
    throw new Error("The spreadsheet writer is unavailable.");
  }
  const workbook = XLSX.utils.book_new();
  const columns = templateColumns(table);
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(templateSheetRows(columns)),
    table.label.slice(0, 31),
  );
  const instructions = instructionRows(table, extraAllowed);
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Column", "Required", "Format", "Example", "Allowed values"],
      ...instructions.map((row) => [row.column, row.required, row.format, row.example, row.allowed]),
    ]),
    "Instructions",
  );
  return asBytes(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}
