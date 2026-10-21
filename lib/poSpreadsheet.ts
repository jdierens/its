import { unzipSync, strFromU8 } from "fflate";

const MAX_BYTES = 700_000;
const MAX_ENTRY = 2_000_000;

export function readTabularFile(name: string, bytes: Uint8Array): string[][] {
  if (bytes.byteLength === 0) throw new Error("The file is empty.");
  if (bytes.byteLength > MAX_BYTES) throw new Error("That file is too large.");
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return parseCsv(new TextDecoder().decode(bytes));
  if (lower.endsWith(".xlsx")) return readXlsx(bytes);
  throw new Error("Use a CSV or XLSX file.");
}

export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        return wantedZipEntry(file.name) && file.originalSize >= 0 && file.originalSize <= MAX_ENTRY;
      },
    });
  } catch {
    throw new Error("Could not read that XLSX file.");
  }
  const sheetName = firstSheetName(files);
  const sheet = sheetName ? files[sheetName] : undefined;
  if (!sheet) throw new Error("The file has no sheet.");
  const strings = files["xl/sharedStrings.xml"] ? sharedStrings(strFromU8(files["xl/sharedStrings.xml"])) : [];
  return sheetRows(strFromU8(sheet), strings);
}

function wantedZipEntry(name: string): boolean {
  return (
    name === "xl/sharedStrings.xml" ||
    name === "xl/workbook.xml" ||
    name === "xl/_rels/workbook.xml.rels" ||
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  );
}

function firstSheetName(files: Record<string, Uint8Array>): string | null {
  const rels = files["xl/_rels/workbook.xml.rels"];
  const book = files["xl/workbook.xml"];
  if (rels && book) {
    const relXml = strFromU8(rels);
    const bookXml = strFromU8(book);
    const id = bookXml.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
    if (id) {
      const byId = new RegExp(`<Relationship\\b[^>]*\\bId="${id}"[^>]*\\bTarget="([^"]+)"`).exec(relXml);
      const byTarget = new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${id}"`).exec(relXml);
      const target = (byId ?? byTarget)?.[1];
      if (target) {
        const path = target.startsWith("/")
          ? target.slice(1)
          : target.startsWith("xl/")
            ? target
            : `xl/${target.replace(/^\.\.\//, "")}`;
        if (files[path]) return path;
      }
    }
  }
  return (
    Object.keys(files)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort()[0] ?? null
  );
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) ?? []) {
    const texts = [...si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1]));
    out.push(texts.join(""));
  }
  return out;
}

function sheetRows(xml: string, strings: string[]): string[][] {
  const matrix: string[][] = [];
  for (const rowXml of xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const rowNumber = rowXml.match(/^<row\b[^>]*\br="(\d+)"/)?.[1];
    const rowIndex = rowNumber ? Number(rowNumber) - 1 : matrix.length;
    const line: string[] = [];
    for (const cell of rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = cell.match(/\br="([A-Z]+)\d+"/)?.[1];
      const col = ref ? columnIndex(ref) : line.length;
      const type = cell.match(/\bt="([^"]+)"/)?.[1] ?? "";
      let value = "";
      if (type === "inlineStr") {
        value = [...cell.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
      } else {
        const raw = cell.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        value = type === "s" ? (strings[Number(raw)] ?? "") : decodeXml(raw);
      }
      line[col] = value.trim();
    }
    if (rowIndex >= 0 && rowIndex < 500) matrix[rowIndex] = line.map((value) => value ?? "");
  }
  return matrix.filter((line) => line != null);
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
