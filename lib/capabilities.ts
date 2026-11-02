/**
 * One map from role (plus the pricing-officer assignment) to capabilities.
 * Call sites ask for a capability. They do not compare role names.
 * can_edit_financials implies can_view_financials. Pending and disabled
 * accounts get nothing. With sign-in off, the open app has every capability.
 */
export const CAPABILITIES = [
  "can_view_financials",
  "can_edit_financials",
  "can_allocate_cogs",
  "can_edit_items",
  "can_add_photos",
  "can_log_picks",
  "can_move_bins",
  "can_receive",
  "can_adjust_counts",
  "can_manage_warehouse",
  "can_manage_catalog",
  "can_manage_users",
  "can_manage_integrations",
  "can_edit_settings",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const EMPTY: ReadonlySet<Capability> = new Set();
const ALL: ReadonlySet<Capability> = new Set(CAPABILITIES);

/**
 * Clerk proposals are confirmed for this ship. Guesses that stay as the
 * recommended reading: staff do not get integrations; staff can edit the
 * settings page (it is not split); warehouse roles get no settings at all,
 * including the bin counter, so the pricing window does not leak; warehouse
 * managers do not manage the catalog.
 * can_allocate_cogs is not on a role. The pricing officer assignment adds it,
 * and also can_view_financials.
 */
const ROLE_CAPABILITIES: Record<
  "admin" | "staff" | "warehouse_manager" | "warehouse_clerk" | "read_only",
  readonly Capability[]
> = {
  admin: [
    "can_view_financials",
    "can_edit_financials",
    "can_edit_items",
    "can_add_photos",
    "can_log_picks",
    "can_move_bins",
    "can_receive",
    "can_adjust_counts",
    "can_manage_warehouse",
    "can_manage_catalog",
    "can_manage_users",
    "can_manage_integrations",
    "can_edit_settings",
  ],
  staff: [
    "can_view_financials",
    "can_edit_financials",
    "can_edit_items",
    "can_add_photos",
    "can_log_picks",
    "can_move_bins",
    "can_receive",
    "can_adjust_counts",
    "can_manage_warehouse",
    "can_manage_catalog",
    "can_edit_settings",
  ],
  warehouse_manager: [
    "can_edit_items",
    "can_add_photos",
    "can_log_picks",
    "can_move_bins",
    "can_receive",
    "can_adjust_counts",
    "can_manage_warehouse",
  ],
  warehouse_clerk: ["can_add_photos", "can_log_picks", "can_move_bins", "can_receive"],
  read_only: ["can_view_financials"],
};

export type CapabilityInput = {
  role: string | null;
  status?: string | null;
  pricingOfficer?: boolean;
  authOn: boolean;
};

type KnownRole = keyof typeof ROLE_CAPABILITIES;

export function isKnownRole(value: string | null | undefined): value is KnownRole {
  return (
    value === "admin" ||
    value === "staff" ||
    value === "read_only" ||
    value === "warehouse_manager" ||
    value === "warehouse_clerk"
  );
}

export function capabilitiesFor(input: CapabilityInput): ReadonlySet<Capability> {
  if (!input.authOn) return ALL;
  if (input.status != null && input.status !== "approved") return EMPTY;
  if (!isKnownRole(input.role)) return EMPTY;
  const caps = new Set<Capability>(ROLE_CAPABILITIES[input.role]);
  if (caps.has("can_edit_financials")) caps.add("can_view_financials");
  if (input.pricingOfficer) {
    caps.add("can_allocate_cogs");
    caps.add("can_view_financials");
  }
  return caps;
}

export function hasCapability(caps: ReadonlySet<Capability>, capability: Capability): boolean {
  return caps.has(capability);
}

const PRICE_FIELDS = new Set(["ecommerce_price", "market_price", "msrp"]);

export function isFinancialItemField(field: string): boolean {
  return PRICE_FIELDS.has(field);
}

/** Settings stays hidden for warehouse roles until the page is split. */
export function canOpenSettings(input: CapabilityInput): boolean {
  if (input.role === "warehouse_manager" || input.role === "warehouse_clerk") return false;
  const caps = capabilitiesFor(input);
  return caps.has("can_view_financials") || caps.has("can_edit_settings");
}

export function routeAllowed(pathname: string, input: CapabilityInput): boolean {
  if (!input.authOn) return true;
  const caps = capabilitiesFor(input);
  if (pathname === "/admin/users" || pathname.startsWith("/admin/users/")) return caps.has("can_manage_users");
  if (pathname === "/admin/data" || pathname.startsWith("/admin/data/")) return caps.has("can_manage_users");
  if (pathname === "/admin/integrations" || pathname.startsWith("/admin/integrations/")) {
    return caps.has("can_manage_integrations");
  }
  if (pathname === "/admin/manufacturers" || pathname.startsWith("/admin/manufacturers/")) {
    return caps.has("can_manage_catalog");
  }
  if (pathname === "/admin/settings" || pathname.startsWith("/admin/settings/")) return canOpenSettings(input);
  if (pathname === "/pricing" || pathname.startsWith("/pricing/")) return caps.has("can_view_financials");
  return true;
}

export const CAPABILITY_DENIED: Record<Capability, string> = {
  can_view_financials: "You cannot view prices.",
  can_edit_financials: "You cannot change prices or orders.",
  can_allocate_cogs: "Only a pricing officer can allocate cost.",
  can_edit_items: "You cannot edit items.",
  can_add_photos: "You cannot add photos.",
  can_log_picks: "You cannot record picks.",
  can_move_bins: "You cannot move bins.",
  can_receive: "You cannot receive stock.",
  can_adjust_counts: "You cannot adjust counts.",
  can_manage_warehouse: "You cannot manage the warehouse.",
  can_manage_catalog: "You cannot change the catalog.",
  can_manage_users: "Only an approved admin can change users.",
  can_manage_integrations: "You cannot change integrations.",
  can_edit_settings: "You cannot change settings.",
};
