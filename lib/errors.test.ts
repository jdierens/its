import assert from "node:assert/strict";
import test from "node:test";
import { errorText, installExposeErrors, uninstallExposeErrors } from "./errors.ts";

const BOILERPLATE =
  "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error.";

test("a unique violation names the field, the value, and the constraint", () => {
  const message = errorText({
    code: "23505",
    message: 'duplicate key value violates unique constraint "items_sku_key"',
    details: "Key (sku)=(ABC-123) already exists.",
  });
  assert.match(message, /Failed to save/);
  assert.match(message, /"ABC-123"/);
  assert.match(message, /must be unique for sku/);
  assert.match(message, /items_sku_key/);
  assert.doesNotMatch(message, /omitted in production/);
});

test("a composite unique violation names each field", () => {
  const message = errorText({
    message: 'duplicate key value violates unique constraint "attributes_identity_uidx"',
    details: "Key (taxonomy_id, lower(name))=(9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d, RAM) already exists.",
  });
  assert.match(message, /taxonomy_id "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"/);
  assert.match(message, /lower\(name\) "RAM"/);
  assert.match(message, /must be unique together/);
  assert.match(message, /attributes_identity_uidx/);
});

test("a unique violation without a key still names the constraint", () => {
  assert.equal(
    errorText({ message: 'duplicate key value violates unique constraint "bins_number_unique"' }),
    "Failed to save: a duplicate value already exists. It must be unique (bins_number_unique).",
  );
});

test("a human sentence with a unique-violation code is kept", () => {
  const message = "10042-C already exists. Scan it instead of creating a new one.";
  assert.equal(errorText({ code: "23505", message }), message);
});

test("a foreign key names the missing field and table", () => {
  const message = errorText({
    code: "23503",
    message: 'insert or update on table "so_lines" violates foreign key constraint "so_lines_item_id_fkey"',
    details: 'Key (item_id)=(missing-sku) is not present in table "items".',
  });
  assert.match(message, /item_id "missing-sku"/);
  assert.match(message, /is not in items/);
  assert.match(message, /so_lines_item_id_fkey/);
});

test("a foreign key that is still referenced names the table", () => {
  const message = errorText({
    message:
      'update or delete on table "items" violates foreign key constraint "item_attributes_attribute_id_fkey" on table "item_attributes"',
    details: 'Key (id)=(abc) is still referenced from table "item_attributes".',
  });
  assert.match(message, /id "abc"/);
  assert.match(message, /still used by item_attributes/);
  assert.match(message, /item_attributes_attribute_id_fkey/);
});

test("a not-null violation names the column", () => {
  assert.equal(
    errorText({
      code: "23502",
      message: 'null value in column "name" of relation "items" violates not-null constraint',
      details: "Failing row contains (null, other).",
    }),
    "Failed to save: name is required on items.",
  );
});

test("a check violation keeps the constraint name", () => {
  assert.equal(
    errorText({
      code: "23514",
      message: 'new row for relation "so_lines" violates check constraint "so_lines_text_check"',
    }),
    "Failed to save: so_lines_text_check on so_lines was not satisfied.",
  );
});

test("invalid input and values that are too long say what was rejected", () => {
  assert.equal(
    errorText({ message: 'invalid input syntax for type uuid: "nope"' }),
    'Failed to save: "nope" is not a valid uuid.',
  );
  assert.equal(
    errorText({ message: "value too long for type character varying(40)" }),
    "Failed to save: the value is too long for character varying(40).",
  );
  assert.equal(errorText({ message: "integer out of range" }), "Failed to save: the number is out of range.");
});

test("an application sentence is kept, including one wrapped by PostgREST", () => {
  assert.equal(errorText(new Error("Choose a customer.")), "Choose a customer.");
  assert.match(
    errorText({
      message: "approve_sales_order failed",
      details: "Line 1 must be allocated to SKUs that add up to the quantity.",
      hint: "PL/pgSQL function public.approve_sales_order",
    }),
    /Line 1 must be allocated to SKUs that add up to the quantity\./,
  );
});

test("connection strings and tokens are not shown", () => {
  const message = errorText({
    message: "connect postgres://app:secret@db.internal:5432/its failed",
    details: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature",
  });
  assert.match(message, /\[redacted\]/);
  assert.doesNotMatch(message, /secret@db/);
  assert.doesNotMatch(message, /eyJhbGci/);
  assert.match(
    errorText({
      message: 'duplicate key value violates unique constraint "items_sku_key"',
      details: "Key (sku)=(sb_secret_live_example) already exists.",
    }),
    /"\[redacted\]"/,
  );
});

test("an empty failure uses the caller fallback", () => {
  assert.equal(errorText(null), "Something went wrong.");
  assert.equal(errorText(undefined, "Save failed."), "Save failed.");
});

test("the production redaction still shows the digest sentence", () => {
  const client = Object.assign(new Error(BOILERPLATE), {
    digest: 'Failed to save: "ABC-123" already exists. It must be unique for sku (items_sku_key).',
  });
  assert.equal(
    errorText(client),
    'Failed to save: "ABC-123" already exists. It must be unique for sku (items_sku_key).',
  );
  assert.match(errorText(new Error(BOILERPLATE)), /omitted in production builds/);
  assert.match(errorText(Object.assign(new Error(BOILERPLATE), { digest: "1477216125" })), /omitted in production builds/);
});

test("a thrown database error carries the operator sentence on digest", () => {
  installExposeErrors();
  try {
    const thrown = new Error('duplicate key value violates unique constraint "items_sku_key"') as Error & {
      details?: string;
      digest?: string;
    };
    thrown.details = "Key (sku)=(ABC-123) already exists.";
    assert.match(thrown.digest ?? "", /"ABC-123"/);
    assert.match(thrown.digest ?? "", /items_sku_key/);
    const client = new Error(BOILERPLATE) as Error & { digest?: string };
    client.digest = thrown.digest;
    assert.equal(errorText(client), thrown.digest);
  } finally {
    uninstallExposeErrors();
  }
});
