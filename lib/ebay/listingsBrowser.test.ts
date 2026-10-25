import assert from "node:assert/strict";
import test from "node:test";
import { NAV_GROUPS, pageMetaFor } from "@/lib/nav";
import { ebayListingSearchFilter, matchListingDecision, parseEbayListingQuery } from "./listingsBrowser.ts";

test("listing query keeps a known match filter and a positive page", () => {
  assert.deepEqual(parseEbayListingQuery({ q: "  kit  ", match: "unmatched", page: "3" }), {
    q: "kit",
    match: "unmatched",
    page: 3,
  });
  assert.deepEqual(parseEbayListingQuery({ match: "nope", page: "0" }), { q: "", match: "all", page: 1 });
  assert.equal(parseEbayListingQuery({ q: "x".repeat(200) }).q.length, 120);
});

test("listing search quotes commas and ignores a bad item id", () => {
  assert.equal(
    ebayListingSearchFilter("a,b", ["not-a-uuid"]),
    'title.ilike."%a,b%",sku.ilike."%a,b%",variation_sku.ilike."%a,b%",ebay_item_id.ilike."%a,b%"',
  );
  assert.equal(ebayListingSearchFilter("", ["not-a-uuid"]), null);
  assert.match(
    ebayListingSearchFilter("", ["11111111-1111-4111-8111-111111111111"]) ?? "",
    /item_id\.in\.\(11111111-1111-4111-8111-111111111111\)/,
  );
});

test("a match is only for a listing that has no item", () => {
  assert.deepEqual(
    matchListingDecision({ listingFound: true, listingItemId: null, itemExists: true }),
    { ok: true },
  );
  assert.equal(
    matchListingDecision({ listingFound: true, listingItemId: "item-1", itemExists: true }).ok,
    false,
  );
  assert.equal(matchListingDecision({ listingFound: false, listingItemId: null, itemExists: true }).ok, false);
  assert.equal(matchListingDecision({ listingFound: true, listingItemId: null, itemExists: false }).ok, false);
});

test("eBay listings are in the admin nav", () => {
  const admin = NAV_GROUPS.find((group) => group.label === "Admin");
  const integrations = admin?.items.find((item) => item.href === "/admin/integrations");
  const listings = integrations?.children?.find((child) => child.href === "/admin/integrations/ebay/listings");
  assert.equal(listings?.label, "eBay listings");
  const meta = pageMetaFor("/admin/integrations/ebay/listings");
  assert.equal(meta.title, "eBay listings");
  assert.equal(meta.backHref, "/admin/integrations/ebay");
});
