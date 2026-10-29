/** Text drawn by a PDF. Scanned pages with no text layer return an empty string. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pieces: string[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const streamAt = indexOfToken(bytes, "stream", cursor);
    if (streamAt < 0) break;
    const dictStart = lastIndexOf(bytes, "<<", streamAt);
    const dict = dictStart >= 0 ? latin1(bytes.subarray(dictStart, streamAt)) : "";
    let dataStart = streamAt + "stream".length;
    if (bytes[dataStart] === 0x0d) dataStart += 1;
    if (bytes[dataStart] === 0x0a) dataStart += 1;
    const length = /\/Length\s+(\d+)/.exec(dict);
    let dataEnd = length ? dataStart + Number(length[1]) : indexOf(bytes, "endstream", dataStart);
    if (dataEnd < dataStart) dataEnd = bytes.length;
    const raw = bytes.subarray(dataStart, Math.min(dataEnd, bytes.length));
    const inflated = /\/FlateDecode\b/.test(dict) ? await inflate(raw) : raw;
    if (inflated) pieces.push(...textPieces(latin1(inflated)));
    cursor = Math.max(dataEnd, dataStart + 1);
  }
  if (pieces.length === 0) return "";
  const short = pieces.every((piece) => piece.length <= 2);
  return pieces.join(short ? "" : "\n");
}

function textPieces(content: string): string[] {
  const pieces: string[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === "(") {
      const parsed = literalString(content, index);
      if (parsed.text.trim()) pieces.push(parsed.text);
      index = parsed.end;
      continue;
    }
    if (char === "<" && content[index + 1] !== "<") {
      const end = content.indexOf(">", index + 1);
      if (end > index) {
        const text = hexString(content.slice(index + 1, end));
        if (text.trim()) pieces.push(text);
        index = end;
      }
    }
  }
  return pieces;
}

function literalString(content: string, open: number): { text: string; end: number } {
  let text = "";
  let depth = 1;
  for (let index = open + 1; index < content.length; index += 1) {
    const char = content[index];
    if (char === "\\") {
      const next = content[index + 1] ?? "";
      const mapped: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      text += mapped[next] ?? next;
      index += 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
      text += char;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return { text, end: index };
      text += char;
      continue;
    }
    text += char;
  }
  return { text, end: content.length };
}

function hexString(value: string): string {
  const hex = value.replace(/\s+/g, "");
  if (hex.length < 4 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return "";
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    return text;
  }
  return latin1(bytes);
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  for (const format of ["deflate", "deflate-raw"] as const) {
    try {
      const stream = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Try the other wrapper. A stream that is not deflate is skipped.
    }
  }
  return null;
}

function latin1(bytes: Uint8Array): string {
  let text = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    text += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return text;
}

function indexOfToken(haystack: Uint8Array, needle: string, from: number): number {
  let cursor = from;
  while (cursor < haystack.length) {
    const at = indexOf(haystack, needle, cursor);
    if (at < 0) return -1;
    const precededByEnd = at >= 3 && latin1(haystack.subarray(at - 3, at)) === "end";
    if (!precededByEnd) return at;
    cursor = at + needle.length;
  }
  return -1;
}

function indexOf(haystack: Uint8Array, needle: string, from: number): number {
  const bytes = ascii(needle);
  outer: for (let index = from; index <= haystack.length - bytes.length; index += 1) {
    for (let offset = 0; offset < bytes.length; offset += 1) {
      if (haystack[index + offset] !== bytes[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function lastIndexOf(haystack: Uint8Array, needle: string, before: number): number {
  const bytes = ascii(needle);
  const last = Math.min(before, haystack.length) - bytes.length;
  outer: for (let index = last; index >= 0; index -= 1) {
    for (let offset = 0; offset < bytes.length; offset += 1) {
      if (haystack[index + offset] !== bytes[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0));
}
