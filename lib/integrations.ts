export const INTEGRATIONS_HOME = "/admin/integrations";

export const INTEGRATIONS = [
  {
    id: "quickbooks",
    label: "QuickBooks",
    href: "/admin/integrations/quickbooks",
    description: "Sync customers and vendors.",
  },
  {
    id: "ebay",
    label: "eBay",
    href: "/admin/integrations/ebay",
    description: "Seller connection and active listings.",
  },
  {
    id: "google",
    label: "Google",
    href: null,
    description: "Coming soon.",
  },
  {
    id: "brokerbin",
    label: "BrokerBin",
    href: null,
    description: "Coming soon.",
  },
] as const;

export type IntegrationId = (typeof INTEGRATIONS)[number]["id"];

// OAuth callbacks land on the matching sub-page. A visit with no callback
// query, including eBay's auth-declined URL, stays on the overview.
export function integrationReturnHref(params: URLSearchParams): string | null {
  if (params.has("ebay_connected") || params.has("ebay_error")) {
    return "/admin/integrations/ebay";
  }
  if (params.has("connected")) return "/admin/integrations/quickbooks";
  return null;
}
