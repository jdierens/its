export const SYNC_STATUSES = ["local", "pending", "synced", "error", "conflict"] as const;

export type SyncStatus = (typeof SYNC_STATUSES)[number];
export type ContactKind = "customer" | "vendor";

export type PostalAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  countrySubDivisionCode: string | null;
  postalCode: string | null;
  country: string | null;
};

export type ContactFields = {
  display_name: string;
  company_name: string | null;
  given_name: string | null;
  family_name: string | null;
  primary_email: string | null;
  phone: string | null;
  billing_address: PostalAddress | null;
  shipping_address: PostalAddress | null;
  tax_id: string | null;
  notes: string | null;
  active: boolean;
  qbo_id: string | null;
  qbo_sync_token: string | null;
  qbo_last_updated: string | null;
};

const ADDRESS_FIELDS = [
  ["Line1", "line1"],
  ["City", "city"],
  ["CountrySubDivisionCode", "countrySubDivisionCode"],
  ["PostalCode", "postalCode"],
  ["Country", "country"],
] as const;

export function tableFor(kind: ContactKind): "customers" | "vendors" {
  return kind === "customer" ? "customers" : "vendors";
}

export function qboEntityName(kind: ContactKind): "Customer" | "Vendor" {
  return kind === "customer" ? "Customer" : "Vendor";
}

export function qboEntityPath(kind: ContactKind): "customer" | "vendor" {
  return kind === "customer" ? "customer" : "vendor";
}

export function isQboDeleted(entity: Record<string, unknown>): boolean {
  return entity.status === "Deleted";
}

export function fromQbo(kind: ContactKind, entity: Record<string, unknown>): ContactFields {
  const displayName = readString(entity.DisplayName);
  if (!displayName) {
    throw new Error("QuickBooks record is missing DisplayName.");
  }

  const metadata = asRecord(entity.MetaData);
  return {
    display_name: displayName,
    company_name: readString(entity.CompanyName),
    given_name: readString(entity.GivenName),
    family_name: readString(entity.FamilyName),
    primary_email: readString(asRecord(entity.PrimaryEmailAddr)?.Address),
    phone: readString(asRecord(entity.PrimaryPhone)?.FreeFormNumber),
    billing_address: readAddress(entity.BillAddr),
    shipping_address: kind === "customer" ? readAddress(entity.ShipAddr) : null,
    tax_id: kind === "customer" ? readString(entity.ResaleNum) : readString(entity.TaxIdentifier),
    notes: readString(entity.Notes),
    active: entity.Active === false || entity.Active === "false" ? false : true,
    qbo_id: readId(entity.Id),
    qbo_sync_token: readId(entity.SyncToken),
    qbo_last_updated: readString(metadata?.LastUpdatedTime),
  };
}

export function toQboBody(
  kind: ContactKind,
  row: ContactFields,
  mode: "create" | "update",
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    DisplayName: row.display_name,
    Active: row.active,
  };

  if (mode === "update") {
    body.Id = row.qbo_id;
    body.SyncToken = row.qbo_sync_token;
    body.sparse = true;
  }

  putText(body, "CompanyName", row.company_name, mode);
  putText(body, "GivenName", row.given_name, mode);
  putText(body, "FamilyName", row.family_name, mode);

  if (row.primary_email) body.PrimaryEmailAddr = { Address: row.primary_email };
  if (row.phone) body.PrimaryPhone = { FreeFormNumber: row.phone };

  const billing = toQboAddress(row.billing_address);
  if (billing) body.BillAddr = billing;

  if (kind === "customer") {
    const shipping = toQboAddress(row.shipping_address);
    if (shipping) body.ShipAddr = shipping;
    putText(body, "Notes", row.notes, mode);
    putText(body, "ResaleNum", row.tax_id, mode);
  } else {
    putText(body, "TaxIdentifier", row.tax_id, mode);
  }

  return body;
}

export function formatQboTime(date: Date): string {
  return `${date.toISOString().replace(/\.\d{3}Z$/, "")}-00:00`;
}

export function preserveVendorLocalFields(
  kind: ContactKind,
  incoming: ContactFields,
  existing: { notes: string | null; shipping_address: PostalAddress | null } | null,
): ContactFields {
  if (kind !== "vendor" || !existing) return incoming;
  return {
    ...incoming,
    notes: incoming.notes ?? existing.notes,
    shipping_address: existing.shipping_address,
  };
}

function putText(
  body: Record<string, unknown>,
  key: string,
  value: string | null,
  mode: "create" | "update",
) {
  if (value) {
    body[key] = value;
    return;
  }
  if (mode === "update") body[key] = "";
}

function toQboAddress(address: PostalAddress | null): Record<string, string> | null {
  if (!address) return null;
  const body: Record<string, string> = {};
  for (const [qboKey, localKey] of ADDRESS_FIELDS) {
    const value = address[localKey];
    if (value) body[qboKey] = value;
  }
  if (address.line2) body.Line2 = address.line2;
  return Object.keys(body).length > 0 ? body : null;
}

function readAddress(value: unknown): PostalAddress | null {
  const record = asRecord(value);
  if (!record) return null;
  const line2 = [readString(record.Line2), readString(record.Line3)].filter(
    (part): part is string => Boolean(part),
  );
  const address: PostalAddress = {
    line1: readString(record.Line1),
    line2: line2.length > 0 ? line2.join(", ") : null,
    city: readString(record.City),
    countrySubDivisionCode: readString(record.CountrySubDivisionCode),
    postalCode: readString(record.PostalCode),
    country: readString(record.Country),
  };
  const hasValue = Object.values(address).some((part) => part);
  return hasValue ? address : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return readString(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
