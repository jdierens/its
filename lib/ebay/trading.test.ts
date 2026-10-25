import assert from "node:assert/strict";
import test from "node:test";
import { activeListRequestXml, fetchActiveListPage, parseActiveList } from "./trading.ts";

const VARIATION_LISTING = `
<Item>
  <ItemID>111111111111</ItemID>
  <Title><![CDATA[Kit &amp; bundle]]></Title>
  <SKU>PARENT</SKU>
  <QuantityAvailable>9</QuantityAvailable>
  <SellingStatus>
    <CurrentPrice currencyID="USD">19.99</CurrentPrice>
    <ListingStatus>Active</ListingStatus>
  </SellingStatus>
  <ListingDetails>
    <ViewItemURL>https://www.ebay.com/itm/111111111111</ViewItemURL>
  </ListingDetails>
  <Variations>
    <Variation>
      <SKU>KIT-RED</SKU>
      <Quantity>2</Quantity>
      <StartPrice currencyID="USD">10.00</StartPrice>
    </Variation>
    <Variation>
      <SKU>KIT-BLUE</SKU>
      <Quantity>0</Quantity>
    </Variation>
  </Variations>
</Item>`;

const SINGLE_LISTING = `
<Item>
  <ItemID>222222222222</ItemID>
  <Title>Plain widget</Title>
  <SKU>PLAIN-1</SKU>
  <QuantityAvailable>4</QuantityAvailable>
  <SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus>
</Item>`;

function page(items: string, totalPages: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList>
    <PaginationResult>
      <TotalNumberOfPages>${totalPages}</TotalNumberOfPages>
    </PaginationResult>
    <ItemArray>${items}</ItemArray>
  </ActiveList>
</GetMyeBaySellingResponse>`;
}

test("active list request is GetMyeBaySelling and does not send a price or a write verb", () => {
  const xml = activeListRequestXml(2, 200);
  assert.match(xml, /<GetMyeBaySellingRequest/);
  assert.match(xml, /<PageNumber>2<\/PageNumber>/);
  assert.match(xml, /<EntriesPerPage>200<\/EntriesPerPage>/);
  assert.doesNotMatch(xml, /AddItem|ReviseItem|EndItem|CurrentPrice|StartPrice/);
});

test("parser keeps one row per variation and drops prices", () => {
  const parsed = parseActiveList(page(VARIATION_LISTING + SINGLE_LISTING, 3));
  assert.equal(parsed.ack, "Success");
  assert.equal(parsed.totalPages, 3);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(
    parsed.rows.map((row) => [row.ebayItemId, row.sku, row.variationSku, row.quantityAvailable, row.title]),
    [
      ["111111111111", "PARENT", "KIT-RED", 2, "Kit & bundle"],
      ["111111111111", "PARENT", "KIT-BLUE", 0, "Kit & bundle"],
      ["222222222222", "PLAIN-1", null, 4, "Plain widget"],
    ],
  );
  assert.equal(parsed.rows[2]?.listingUrl, "https://www.ebay.com/itm/222222222222");
  assert.equal(parsed.rows[0]?.pictureUrl, null);
  assert.equal(JSON.stringify(parsed.rows).includes("19.99"), false);
  assert.equal(JSON.stringify(parsed.rows).includes("10.00"), false);
});

test("picture url is the https PictureURL, else GalleryURL, shared by variations", () => {
  const parsed = parseActiveList(
    page(
      `<Item>
        <ItemID>333333333333</ItemID>
        <Title>Pictured</Title>
        <SKU>PIC</SKU>
        <PictureDetails>
          <GalleryURL>https://i.ebayimg.com/images/g/gallery/s-l140.jpg</GalleryURL>
          <PictureURL>https://i.ebayimg.com/images/g/full/s-l1600.jpg</PictureURL>
        </PictureDetails>
        <Variations>
          <Variation><SKU>PIC-A</SKU><Quantity>1</Quantity></Variation>
          <Variation><SKU>PIC-B</SKU><Quantity>1</Quantity></Variation>
        </Variations>
      </Item>
      <Item>
        <ItemID>444444444444</ItemID>
        <Title>Gallery only</Title>
        <SKU>GAL</SKU>
        <PictureDetails><GalleryURL>https://i.ebayimg.com/images/g/only/s-l140.jpg</GalleryURL></PictureDetails>
      </Item>
      <Item>
        <ItemID>555555555555</ItemID>
        <Title>Insecure</Title>
        <SKU>HTTP</SKU>
        <PictureDetails><GalleryURL>http://example.com/a.jpg</GalleryURL></PictureDetails>
      </Item>`,
      1,
    ),
  );
  assert.equal(parsed.rows[0]?.pictureUrl, "https://i.ebayimg.com/images/g/full/s-l1600.jpg");
  assert.equal(parsed.rows[1]?.pictureUrl, "https://i.ebayimg.com/images/g/full/s-l1600.jpg");
  assert.equal(parsed.rows[2]?.pictureUrl, "https://i.ebayimg.com/images/g/only/s-l140.jpg");
  assert.equal(parsed.rows[3]?.pictureUrl, null);
  assert.equal(JSON.stringify(parsed.rows).includes("http://example.com"), false);
});

test("failure ack keeps the eBay message and error code", () => {
  const parsed = parseActiveList(`<GetMyeBaySellingResponse>
    <Ack>Failure</Ack>
    <Errors>
      <LongMessage>Auth token is invalid.</LongMessage>
      <ErrorCode>931</ErrorCode>
    </Errors>
  </GetMyeBaySellingResponse>`);
  assert.equal(parsed.ack, "Failure");
  assert.equal(parsed.error, "Auth token is invalid.");
  assert.equal(parsed.errorCode, "931");
  assert.deepEqual(parsed.rows, []);
});

test("IAF header is sent and a 401 refreshes the token once", async () => {
  const seen: { token: string; call: string | null; body: string }[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    seen.push({
      token: headers.get("X-EBAY-API-IAF-TOKEN") ?? "",
      call: headers.get("X-EBAY-API-CALL-NAME"),
      body: String(init?.body ?? ""),
    });
    if (seen.length === 1) return new Response("unauthorized", { status: 401 });
    return new Response(page(SINGLE_LISTING, 1), { status: 200, headers: { rlogid: "rlog-page" } });
  };
  let refreshed = 0;
  const result = await fetchActiveListPage({
    environment: "production",
    token: "old-token",
    page: 1,
    refresh: async () => {
      refreshed += 1;
      return "new-token";
    },
    fetchImpl,
  });
  assert.equal(refreshed, 1);
  assert.equal(seen[0]?.token, "old-token");
  assert.equal(seen[1]?.token, "new-token");
  assert.equal(seen[0]?.call, "GetMyeBaySelling");
  assert.match(seen[0]?.body ?? "", /GetMyeBaySellingRequest/);
  assert.equal(result.page.rows[0]?.sku, "PLAIN-1");
  assert.equal(result.rlogid, "rlog-page");
  assert.equal(result.token, "new-token");
});
