import { importSizeError } from "@/lib/data/registry";

export type Delimiter = "," | ";" | "\t";

export type SheetTable = {
  name: string;
  headers: string[];
  rows: string[][];
};

export type ParsedWorkbook = {
  sheets: SheetTable[];
  delimiter: Delimiter | null;
};

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function detectDelimiter(text: string): Delimiter {
  const source = stripBom(text);
  const line = firstRecord(source);
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (!quoted && (char === "," || char === ";" || char === "\t")) counts[char] += 1;
  }
  const ranked = (Object.keys(counts) as Delimiter[]).sort((a, b) => counts[b] - counts[a]);
  if (counts[ranked[0]] === 0) return ",";
  if (counts[ranked[0]] === counts[","]) return ",";
  return ranked[0];
}

function firstRecord(text: string): string {
  let quoted = false;
  let record = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        record += char;
        index += 1;
        continue;
      }
      quoted = !quoted;
    }
    if (!quoted && (char === "\n" || char === "\r")) break;
    record += char;
  }
  return record;
}

export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const source = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const name = header.trim() || `Column ${index + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name} (${count + 1})`;
  });
}

export function tableFromRows(name: string, grid: string[][]): SheetTable {
  const [rawHeader, ...rest] = grid;
  if (!rawHeader) return { name, headers: [], rows: [] };
  const headers = uniqueHeaders(rawHeader.map((cell) => cell.replace(/^\uFEFF/, "")));
  const rows = rest.map((cells) => headers.map((_, index) => (cells[index] ?? "").trim()));
  return { name, headers, rows };
}

export function parseCsvText(text: string, name = "CSV"): ParsedWorkbook {
  const sizeError = importSizeError(text.length, 0);
  if (sizeError && text.length > 2 * 1024 * 1024) throw new Error(sizeError);
  const delimiter = detectDelimiter(text);
  const table = tableFromRows(name, parseDelimited(text, delimiter));
  const rowError = importSizeError(0, table.rows.length);
  if (rowError) throw new Error(rowError);
  return { sheets: [table], delimiter };
}

type WorkBook = {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
};

export type XlsxModule = {
  read: (data: ArrayBuffer | Buffer, options: { type: "array" | "buffer" }) => WorkBook;
  write?: (
    workbook: unknown,
    options: { type: "array"; bookType: "xlsx" | "xls" },
  ) => Uint8Array | number[] | ArrayBuffer;
  utils: {
    sheet_to_json: (sheet: unknown, options: { header: 1; raw: false; defval: string }) => unknown[][];
    book_new?: () => unknown;
    aoa_to_sheet?: (rows: string[][]) => unknown;
    book_append_sheet?: (workbook: unknown, sheet: unknown, name: string) => void;
  };
};

export async function loadXlsx(): Promise<XlsxModule> {
  const loaded = (await import("xlsx")) as XlsxModule & { default?: XlsxModule };
  return loaded.utils ? loaded : (loaded.default as XlsxModule);
}

export async function parseSpreadsheet(data: ArrayBuffer, filename: string): Promise<ParsedWorkbook> {
  const sizeError = importSizeError(data.byteLength, 0);
  if (sizeError) throw new Error(sizeError);
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = new TextDecoder("utf-8").decode(data);
    return parseCsvText(text, filename);
  }
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(data, { type: "array" });
  const sheets = workbook.SheetNames.map((name) => {
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
    });
    const rows = grid.map((row) => (Array.isArray(row) ? row : []).map((cell) => String(cell ?? "")));
    return tableFromRows(name, rows);
  }).filter((sheet) => sheet.headers.length > 0);
  const rowError = importSizeError(0, sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0));
  if (rowError) throw new Error(rowError);
  return { sheets, delimiter: null };
}
