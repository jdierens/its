import type { ColumnSpec, DataTable } from "@/lib/data/registry";
import { mappingColumns, templateColumns } from "@/lib/data/registry";

export function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map((value) => csvCell(value ?? "")).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function templateCsv(table: DataTable): string {
  const columns = templateColumns(table);
  return toCsv(
    columns.map((column) => column.key),
    [columns.map((column) => column.example)],
  );
}

export type InstructionRow = {
  column: string;
  required: string;
  format: string;
  example: string;
  allowed: string;
};

export function instructionRows(table: DataTable, extraAllowed: Record<string, string[]> = {}): InstructionRow[] {
  return mappingColumns(table).map((column) => ({
    column: column.key,
    required: column.required ? "Required" : column.template ? "Optional" : "Optional — not in the template",
    format: column.format,
    example: column.example,
    allowed: [...column.allowed, ...(extraAllowed[column.key] ?? [])].join(", "),
  }));
}

export function templateSheetRows(columns: ColumnSpec[]): string[][] {
  return [columns.map((column) => column.key), columns.map((column) => column.example)];
}
