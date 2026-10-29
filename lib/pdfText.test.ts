import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contactFromPoText } from "./orderContact.ts";
import { pdfText } from "./pdfText.ts";

describe("PDF text", () => {
  it("reads a literal string from an uncompressed content stream", async () => {
    const body = "BT (Contact: Ada Buyer) Tj (ada@example.com) Tj ET";
    const bytes = ascii(pdfWithStream(body, null));
    const text = await pdfText(bytes);
    assert.match(text, /Ada Buyer/);
    assert.equal(contactFromPoText(text).email, "ada@example.com");
  });

  it("reads a FlateDecode stream", async () => {
    const body = "BT (Phone: (702) 555-0142) Tj ET";
    const bytes = ascii(await flatePdf(body));
    const text = await pdfText(bytes);
    assert.equal(contactFromPoText(text).phone, "(702) 555-0142");
  });
});

function pdfWithStream(body: string, compressed: Uint8Array | null): string {
  const data = compressed ?? ascii(body);
  const stream = latin1(data);
  return `%PDF-1.4
1 0 obj
<< /Length ${data.length}${compressed ? " /Filter /FlateDecode" : ""} >>
stream
${stream}
endstream
endobj
%%EOF
`;
}

async function flatePdf(body: string): Promise<string> {
  const compressed = new Uint8Array(
    await new Response(new Blob([ascii(body)]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer(),
  );
  return pdfWithStream(body, compressed);
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0));
}

function latin1(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}
