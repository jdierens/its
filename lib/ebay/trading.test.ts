import assert from "node:assert/strict";
import test from "node:test";
import {
  activeListRequestXml,
  fetchActiveListPage,
  fetchSellerListPictures,
  parseActiveList,
  safeHttpsUrl,
  sellerListRequestXml,
  sellerListWindow,
} from "./trading.ts";

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

test("http ebay image hosts are stored as https and other http urls are dropped", () => {
  assert.equal(
    safeHttpsUrl("http://i.ebayimg.com/images/g/abc/s-l140.jpg"),
    "https://i.ebayimg.com/images/g/abc/s-l140.jpg",
  );
  assert.equal(
    safeHttpsUrl("http://thumbs.ebaystatic.com/pict/123.jpg"),
    "https://thumbs.ebaystatic.com/pict/123.jpg",
  );
  assert.equal(safeHttpsUrl("https://i.ebayimg.com/images/g/abc/s-l1600.jpg"), "https://i.ebayimg.com/images/g/abc/s-l1600.jpg");
  assert.equal(safeHttpsUrl("http://example.com/a.jpg"), null);
  assert.equal(safeHttpsUrl("http://i.ebayimg.com.evil.com/a.jpg"), null);
  assert.equal(safeHttpsUrl("http://notebayimg.com/a.jpg"), null);
});

test("an http gallery url on an ebay image host is kept", () => {
  const parsed = parseActiveList(
    page(
      `<Item>
        <ItemID>666666666666</ItemID>
        <Title>Http gallery</Title>
        <SKU>HTTP-EBAY</SKU>
        <PictureDetails><GalleryURL>http://i.ebayimg.com/images/g/only/s-l140.jpg</GalleryURL></PictureDetails>
      </Item>`,
      1,
    ),
  );
  assert.equal(parsed.rows[0]?.pictureUrl, "https://i.ebayimg.com/images/g/only/s-l140.jpg");
});

test("seller list request asks for pictures over the active end-time window", () => {
  const now = new Date("2026-10-30T00:00:00.000Z");
  const window = sellerListWindow(now);
  const xml = sellerListRequestXml(1, window.endTimeFrom, window.endTimeTo, 200);
  assert.match(xml, /<GetSellerListRequest/);
  assert.match(xml, /<GranularityLevel>Coarse<\/GranularityLevel>/);
  assert.match(xml, /<IncludeVariations>false<\/IncludeVariations>/);
  assert.match(xml, new RegExp(`<EndTimeFrom>${window.endTimeFrom}</EndTimeFrom>`));
  assert.match(xml, new RegExp(`<EndTimeTo>${window.endTimeTo}</EndTimeTo>`));
  assert.equal(new Date(window.endTimeTo).getTime() - now.getTime(), 119 * 24 * 60 * 60 * 1000);
  assert.doesNotMatch(xml, /AddItem|ReviseItem|EndItem|CurrentPrice|StartPrice|GetMyeBaySelling/);
  assert.throws(() => sellerListRequestXml(1, "tomorrow", window.endTimeTo), /UTC timestamp/);
});

test("seller list pages supply https picture urls and skip listings with none", async () => {
  const now = new Date("2026-10-30T00:00:00.000Z");
  const window = sellerListWindow(now);
  const pages = [
    page(
      `<Item>
        <ItemID>333</ItemID>
        <Title>Full</Title>
        <PictureDetails>
          <GalleryType>Gallery</GalleryType>
          <GalleryURL>http://i.ebayimg.com/images/g/gal/s-l140.jpg</GalleryURL>
          <PictureURL>https://i.ebayimg.com/images/g/full/s-l1600.jpg</PictureURL>
        </PictureDetails>
      </Item>
      <Item>
        <ItemID>444</ItemID>
        <Title>Gallery</Title>
        <PictureDetails><GalleryURL>http://thumbs.ebaystatic.com/pict/444.jpg</GalleryURL></PictureDetails>
      </Item>`,
      2,
    ),
    page(
      `<Item>
        <ItemID>555</ItemID>
        <Title>None</Title>
      </Item>
      <Item>
        <ItemID>666</ItemID>
        <Title>Hostile</Title>
        <PictureDetails><GalleryURL>http://example.com/a.jpg</GalleryURL></PictureDetails>
      </Item>`,
      2,
    ),
  ];
  const bodies: string[] = [];
  let index = 0;
  const result = await fetchSellerListPictures({
    environment: "production",
    token: "token-1",
    now,
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("X-EBAY-API-CALL-NAME"), "GetSellerList");
      bodies.push(String(init?.body ?? ""));
      return new Response(pages[index++] ?? page("", 2), { status: 200, headers: { rlogid: "pic-rlog" } });
    },
  });
  assert.equal(index, 2);
  assert.match(bodies[0] ?? "", /<PageNumber>1<\/PageNumber>/);
  assert.match(bodies[1] ?? "", /<PageNumber>2<\/PageNumber>/);
  assert.match(bodies[0] ?? "", new RegExp(`<EndTimeFrom>${window.endTimeFrom}</EndTimeFrom>`));
  assert.equal(result.pictures.get("333"), "https://i.ebayimg.com/images/g/full/s-l1600.jpg");
  assert.equal(result.pictures.get("444"), "https://thumbs.ebaystatic.com/pict/444.jpg");
  assert.equal(result.pictures.has("555"), false);
  assert.equal(result.pictures.has("666"), false);
  assert.equal(result.rlogid, "pic-rlog");
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
