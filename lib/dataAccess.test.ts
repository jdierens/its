import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

test("the shared database client is server-only and does not carry the publishable key", () => {
  const client = source("supabase.ts");
  assert.equal(client.includes("createBrowserClient"), false);
  assert.equal(client.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"), false);
  assert.match(client, /requireServiceSupabase/);
  assert.match(source("supabaseBrowser.ts"), /createBrowserClient/);
});

test("browser modules that upload photos or reserve SKUs do not open a database client", () => {
  for (const name of ["imageUpload.ts", "imageFiles.ts", "sku.ts", "bins.ts", "labelTemplates.ts", "poAttachmentUpload.ts", "itemAttachmentUpload.ts"]) {
    const text = source(name);
    assert.equal(text.includes("getSupabase"), false, name);
    assert.equal(text.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"), false, name);
  }
});

test("saving a photo confirms the object without downloading it", () => {
  const images = source("images.ts");
  assert.match(images, /\.exists\(/);
  assert.equal(images.includes("response.body"), false);
  assert.equal(images.includes('Range: "bytes=0-0"'), false);
  const upload = source("imageUpload.ts");
  assert.match(upload, /withDeadline/);
  assert.match(upload, /AbortController/);
  assert.equal(upload.includes("getSupabase"), false);
});
