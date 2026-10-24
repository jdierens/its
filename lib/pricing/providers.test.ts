import assert from "node:assert/strict";
import test from "node:test";
import { collectPriceQuotes } from "./providers.ts";

const env = {
  EBAY_CLIENT_ID: "app-id",
  EBAY_CLIENT_SECRET: "cert-id",
  EBAY_ENVIRONMENT: "sandbox",
};

test("listed prices run, sold prices stay off, and BrokerBin stays off without a key", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/identity/v1/oauth2/token")) {
      const body = String(init?.body ?? "");
      const fields = new URLSearchParams(body);
      assert.equal(fields.get("grant_type"), "client_credentials");
      assert.equal(fields.get("scope"), "https://api.ebay.com/oauth/api_scope");
      return json({ access_token: "app-token", expires_in: 7200 });
    }
    assert.match(url, /item_summary\/search/);
    assert.match(url, /q=HMA82GR7AFR8N-VK/);
    const authorization = new Headers(init?.headers).get("authorization");
    assert.equal(authorization, "Bearer app-token");
    return json({
      itemSummaries: [
        { title: "Module", price: { value: "80.00", currency: "USD" }, seller: { username: "a" } },
        { title: "Other", price: { value: "10.00", currency: "USD" }, seller: { username: "b" } },
      ],
    });
  };

  const reports = await collectPriceQuotes({
    query: "HMA82GR7AFR8N-VK",
    env,
    fetchImpl,
  });
  const listed = reports.find((report) => report.source === "ebay_listed");
  const sold = reports.find((report) => report.source === "ebay_sold");
  const broker = reports.find((report) => report.source === "brokerbin");
  assert.equal(listed?.status, "ran");
  assert.equal(listed?.count, 2);
  assert.equal(sold?.status, "skipped");
  assert.match(sold?.message ?? "", /EBAY_INSIGHTS_ENABLED/);
  assert.equal(broker?.status, "skipped");
  assert.match(broker?.message ?? "", /BROKERBIN_API_KEY/);
});

test("Marketplace Insights runs only when the flag is on", async () => {
  const urls: string[] = [];
  const scopes: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/oauth2/token")) {
      const fields = new URLSearchParams(String(init?.body ?? ""));
      scopes.push(fields.get("scope") ?? "");
      return json({ access_token: "insights-token", expires_in: 7200 });
    }
    return json({
      itemSales: [{ title: "Sold", lastSoldPrice: { value: "22.00", currency: "USD" }, totalSoldQuantity: 2 }],
    });
  };
  const reports = await collectPriceQuotes({
    query: "M393A4K40BB1-CRC",
    env: { ...env, EBAY_INSIGHTS_ENABLED: "true", BROKERBIN_API_KEY: "broker-key" },
    fetchImpl,
  });
  const sold = reports.find((report) => report.source === "ebay_sold");
  const broker = reports.find((report) => report.source === "brokerbin");
  assert.equal(sold?.status, "ran");
  assert.equal(sold?.quotes[0]?.price, 22);
  assert.equal(broker?.status, "ran");
  assert.match(broker?.message ?? "", /not connected/);
  assert.ok(urls.some((url) => url.includes("item_sales/search")));
  assert.deepEqual(scopes, [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights",
  ]);
});

test("a missing eBay key is an error and does not call the network", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return json({});
  };
  const reports = await collectPriceQuotes({
    query: "part",
    env: { EBAY_ENVIRONMENT: "production" },
    fetchImpl,
  });
  assert.equal(reports[0]?.status, "error");
  assert.match(reports[0]?.message ?? "", /EBAY_CLIENT_ID/);
  assert.equal(calls, 0);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
