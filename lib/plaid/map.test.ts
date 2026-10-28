import assert from "node:assert/strict";
import test from "node:test";
import { plaidSchemaMissing, readPlaidError } from "./errors.ts";
import { mapAccount, mapTransaction, statementAmount, updateStatusLabel } from "./map.ts";
import { isPublicToken, isUuid } from "./ids.ts";
import { exposesSecret, publicItem, type ItemRow } from "./types.ts";

test("Plaid amounts flip to the bank-statement sign", () => {
  assert.equal(statementAmount(25.5), -25.5);
  assert.equal(statementAmount(-40), 40);
  assert.equal(statementAmount(0), 0);
});

test("sync rows keep the fields the bank feed shows", () => {
  const account = mapAccount({
    account_id: "acc",
    name: "Checking",
    mask: "1234",
    type: "depository",
    subtype: "checking",
    balances: { current: 10.129, available: null, iso_currency_code: "USD" },
  });
  assert.equal(account?.currentBalance, 10.13);
  assert.equal(account?.availableBalance, null);
  const transaction = mapTransaction({
    transaction_id: "txn",
    account_id: "acc",
    amount: 12.5,
    iso_currency_code: "USD",
    date: "2026-04-02",
    name: "Coffee",
    pending: true,
    personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "COFFEE" },
  });
  assert.equal(transaction?.amount, 12.5);
  assert.equal(transaction?.category?.detailed, "COFFEE");
  assert.equal(mapTransaction({ transaction_id: "x", account_id: "acc", amount: 1, date: "April 2" }), null);
  assert.equal(updateStatusLabel("NOT_READY"), "Plaid is still preparing transactions.");
});

test("a browser item view does not carry the access token", () => {
  const row: ItemRow = {
    id: "11111111-1111-4111-8111-111111111111",
    item_id: "item",
    access_token: "access-sandbox-secret",
    environment: "sandbox",
    institution_id: "ins_1",
    institution_name: "Bank of America",
    status: "active",
    error_code: null,
    error_message: null,
    transactions_cursor: "cursor-secret",
    transactions_update_status: null,
    consent_expiration_time: null,
    webhook_url: null,
    connected_by: null,
    connected_at: "2026-04-15T00:00:00.000Z",
    last_synced_at: null,
  };
  const view = publicItem(row, []);
  assert.equal(exposesSecret(view), false);
  assert.equal(JSON.stringify(view).includes("access-sandbox-secret"), false);
  assert.equal(JSON.stringify(view).includes("cursor-secret"), false);
});

test("public tokens and ids stay in the expected shape", () => {
  assert.equal(isPublicToken("public-sandbox-5c224a01-8314-4491-a06f-39e193d5cddc"), true);
  assert.equal(isPublicToken("access-sandbox-secret"), false);
  assert.equal(isUuid("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isUuid("item-id"), false);
});

test("a missing Plaid table is recognized, and a Plaid error keeps its code", () => {
  assert.equal(
    plaidSchemaMissing({ code: "PGRST205", message: "Could not find the table 'public.plaid_items' in the schema cache" }),
    true,
  );
  assert.equal(plaidSchemaMissing({ code: "42703", message: 'column "name" does not exist' }), false);
  assert.deepEqual(
    readPlaidError({ response: { data: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "login required" } } }),
    { code: "ITEM_LOGIN_REQUIRED", message: "login required" },
  );
});
