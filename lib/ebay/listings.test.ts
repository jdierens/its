import assert from "node:assert/strict";
import test from "node:test";
import { fetchActiveListPage } from "./trading.ts";
import {
  listingMatchSku,
  listingsColumnMissing,
  resolveSkuMap,
  runListingsPull,
  uniqueEbayItemIds,
  withPreservedManualMatch,
  type ListingWrite,
} from "./listings.ts";

test("variation sku wins over the listing sku", () => {
  assert.equal(listingMatchSku({ sku: "PARENT", variationSku: "KIT-RED" }), "KIT-RED");
  assert.equal(listingMatchSku({ sku: "PLAIN-1", variationSku: null }), "PLAIN-1");
  assert.equal(listingMatchSku({ sku: "  ", variationSku: "  " }), null);
});

test("sku matching is exact, then a single case-insensitive hit", () => {
  const matched = resolveSkuMap(
    ["KIT-RED", "plain-1", "AMBIG", "missing"],
    [
      { id: "item-red", sku: "KIT-RED" },
      { id: "item-plain", sku: "PLAIN-1" },
      { id: "item-a", sku: "Ambig" },
      { id: "item-b", sku: "ambig" },
    ],
  );
  assert.equal(matched.get("KIT-RED"), "item-red");
  assert.equal(matched.get("plain-1"), "item-plain");
  assert.equal(matched.has("AMBIG"), false);
  assert.equal(matched.has("missing"), false);
});

test("listing ids are unique and numeric", () => {
  assert.deepEqual(uniqueEbayItemIds(["20", "3", "20", "abc", "3"]), ["3", "20"]);
});

function store() {
  const upserts: ListingWrite[][] = [];
  const ended: string[] = [];
  const requested: string[][] = [];
  return {
    upserts,
    ended,
    requested,
    api: {
      async itemsForSkus(skus: string[]) {
        requested.push(skus);
        return [
          { id: "item-red", sku: "KIT-RED" },
          { id: "item-plain", sku: "PLAIN-1" },
          { id: "item-base", sku: "12345" },
        ];
      },
      async upsert(rows: ListingWrite[]) {
        upserts.push(rows);
      },
      async endMissing(fetchedAt: string) {
        ended.push(fetchedAt);
        return 4;
      },
    },
  };
}

function xml(items: string, totalPages: number): string {
  return `<GetMyeBaySellingResponse>
    <Ack>Success</Ack>
    <ActiveList>
      <PaginationResult><TotalNumberOfPages>${totalPages}</TotalNumberOfPages></PaginationResult>
      <ItemArray>${items}</ItemArray>
    </ActiveList>
  </GetMyeBaySellingResponse>`;
}

const PAGE_ONE = `
<Item>
  <ItemID>111</ItemID>
  <Title>Kit</Title>
  <SKU>PARENT</SKU>
  <PictureDetails>
    <GalleryURL>http://example.com/kit.jpg</GalleryURL>
    <PictureURL>https://i.ebayimg.com/images/g/kit/s-l1600.jpg</PictureURL>
  </PictureDetails>
  <SellingStatus><CurrentPrice currencyID="USD">19.99</CurrentPrice><ListingStatus>Active</ListingStatus></SellingStatus>
  <Variations>
    <Variation><SKU>KIT-RED</SKU><Quantity>2</Quantity><StartPrice currencyID="USD">8.00</StartPrice></Variation>
    <Variation><SKU>NO-ITEM</SKU><Quantity>1</Quantity></Variation>
  </Variations>
</Item>`;

const PAGE_TWO = `
<Item>
  <ItemID>222</ItemID>
  <Title>Plain</Title>
  <SKU>PLAIN-1</SKU>
  <QuantityAvailable>4</QuantityAvailable>
  <SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus>
</Item>`;

test("a full pull upserts matches and ends missing rows only after the last page", async () => {
  const pages = [xml(PAGE_ONE, 2), xml(PAGE_TWO, 2)];
  let index = 0;
  const saved = store();
  const result = await runListingsPull({
    token: "token-1",
    fetchedAt: "2026-10-24T17:00:00.000Z",
    fetchPage: (page, token) =>
      fetchActiveListPage({
        environment: "sandbox",
        token,
        page,
        fetchImpl: async () => new Response(pages[index++] ?? xml("", 2), { status: 200 }),
      }),
    store: saved.api,
  });
  assert.equal(index, 2);
  assert.equal(saved.upserts.length, 1);
  const rows = saved.upserts[0] ?? [];
  assert.equal(rows.length, 3);
  const red = rows.find((row) => row.variation_sku === "KIT-RED");
  const missing = rows.find((row) => row.variation_sku === "NO-ITEM");
  const plain = rows.find((row) => row.ebay_item_id === "222");
  assert.equal(red?.item_id, "item-red");
  assert.equal(red?.picture_url, "https://i.ebayimg.com/images/g/kit/s-l1600.jpg");
  assert.equal(missing?.picture_url, "https://i.ebayimg.com/images/g/kit/s-l1600.jpg");
  assert.equal(plain?.picture_url, null);
  assert.equal(red?.sku, "PARENT");
  assert.equal(red?.pack_qty, 1);
  assert.equal(red?.base_sku, null);
  assert.equal(missing?.item_id, null);
  assert.equal(plain?.item_id, "item-plain");
  assert.equal(plain?.variation_sku, null);
  assert.equal(JSON.stringify(rows).includes("19.99"), false);
  assert.equal(JSON.stringify(rows).includes("8.00"), false);
  assert.deepEqual(saved.ended, ["2026-10-24T17:00:00.000Z"]);
  assert.equal(result.active, 3);
  assert.equal(result.unmatched, 1);
  assert.equal(result.ended, 4);
});

test("a failed later page does not upsert or end listings", async () => {
  const saved = store();
  await assert.rejects(
    () =>
      runListingsPull({
        token: "token-1",
        fetchedAt: "2026-10-24T17:00:00.000Z",
        fetchPage: (page, token) =>
          fetchActiveListPage({
            environment: "sandbox",
            token,
            page,
            fetchImpl: async () =>
              new Response(
                page === 1
                  ? xml(PAGE_TWO, 2)
                  : `<GetMyeBaySellingResponse><Ack>Failure</Ack><Errors><LongMessage>Page failed.</LongMessage></Errors></GetMyeBaySellingResponse>`,
                { status: 200 },
              ),
          }),
        store: saved.api,
      }),
    /Page failed/,
  );
  assert.deepEqual(saved.upserts, []);
  assert.deepEqual(saved.ended, []);
});

test("a pack label is stored on the base item", async () => {
  const saved = store();
  await runListingsPull({
    token: "token-1",
    fetchedAt: "2026-10-24T17:00:00.000Z",
    fetchPage: async () => ({
      token: "token-1",
      rlogid: null,
      requestId: null,
      page: {
        ack: "Success",
        error: null,
        errorCode: null,
        totalPages: 1,
        rows: [
          {
            ebayItemId: "555",
            sku: "12345-4PK",
            variationSku: null,
            title: "Pack",
            quantityAvailable: 1,
            listingStatus: "Active",
            listingUrl: "https://www.ebay.com/itm/555",
            pictureUrl: null,
          },
        ],
      },
    }),
    store: saved.api,
  });
  const row = saved.upserts[0]?.[0];
  assert.equal(row?.item_id, "item-base");
  assert.equal(row?.pack_qty, 4);
  assert.equal(row?.base_sku, "12345");
  const asked = saved.requested.flat();
  assert.equal(asked.includes("12345-4PK"), true);
  assert.equal(asked.includes("12345"), true);
});

test("a missing picture or hand-match column is recognized without treating every column as missing", () => {
  const missingPicture = {
    code: "PGRST204",
    message: "Could not find the 'picture_url' column of 'ebay_listings' in the schema cache",
  };
  assert.equal(listingsColumnMissing(missingPicture, "picture_url"), true);
  assert.equal(listingsColumnMissing(missingPicture, "matched_manually"), false);
  assert.equal(listingsColumnMissing(missingPicture, "pack_qty"), false);
});

test("a hand match is kept when the label still matches no SKU", () => {
  const row = {
    ebay_item_id: "555",
    sku: "NO-ITEM",
    variation_sku: null,
    title: "Loose",
    quantity_available: 1,
    listing_status: "Active",
    listing_url: null,
    picture_url: null,
    item_id: null,
    base_sku: null,
    pack_qty: 1,
    matched_manually: false,
    fetched_at: "2026-10-25T00:00:00.000Z",
  } satisfies ListingWrite;
  const kept = withPreservedManualMatch(row, new Map([["555\u0000", "item-hand"]]));
  assert.equal(kept.item_id, "item-hand");
  assert.equal(kept.matched_manually, true);
  const replaced = withPreservedManualMatch({ ...row, item_id: "item-sku" }, new Map([["555\u0000", "item-hand"]]));
  assert.equal(replaced.item_id, "item-sku");
  assert.equal(replaced.matched_manually, false);
});
