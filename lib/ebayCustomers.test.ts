import assert from "node:assert/strict";
import test from "node:test";
import { EBAY_ORDER_CUSTOMER_NAME } from "./ebay/orderMap.ts";
import { isEbaySourcedCustomer } from "./ebayCustomers.ts";

test("eBay buyers are the member mailbox and the order-pull customer", () => {
  assert.equal(EBAY_ORDER_CUSTOMER_NAME, "eBay Customer");
  assert.equal(
    isEbaySourcedCustomer({ displayName: "Aaron Fox", primaryEmail: "1b3c17992d059bb55751@members.ebay.com" }),
    true,
  );
  assert.equal(
    isEbaySourcedCustomer({ displayName: "ParkLawn EBay", primaryEmail: "0ffd801e277893516240@MEMBERS.EBAY.COM" }),
    true,
  );
  assert.equal(isEbaySourcedCustomer({ displayName: "eBay Customer", primaryEmail: null }), true);
  assert.equal(isEbaySourcedCustomer({ displayName: " ebay customer ", primaryEmail: "" }), true);
  assert.equal(
    isEbaySourcedCustomer({ displayName: "Best Servers LLC - Ebay", primaryEmail: "ebaysales@bestserversllc.net" }),
    false,
  );
  assert.equal(
    isEbaySourcedCustomer({ displayName: "BrightStar Systems LLC", primaryEmail: "josh@brightstar.example" }),
    false,
  );
  assert.equal(isEbaySourcedCustomer({ displayName: "Acme", primaryEmail: null }), false);
});
