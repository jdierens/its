import { errorText } from "@/lib/errors";
import type { ContactKind, PostalAddress, SyncStatus } from "@/lib/qbo/map";
import { tableFor } from "@/lib/qbo/map";
import { getSupabase } from "@/lib/supabase";

export type Contact = {
  id: string;
  displayName: string;
  companyName: string;
  givenName: string;
  familyName: string;
  primaryEmail: string;
  phone: string;
  billingAddress: PostalAddress;
  shippingAddress: PostalAddress;
  taxId: string;
  notes: string;
  active: boolean;
  qboId: string | null;
  syncStatus: SyncStatus;
  qboLastUpdated: string | null;
};

export type ContactInput = Omit<Contact, "id" | "qboId" | "syncStatus" | "qboLastUpdated">;

export type ContactList = {
  rows: Contact[];
  total: number;
};

const LIST_COLUMNS =
  "id, display_name, company_name, given_name, family_name, primary_email, phone, active, qbo_id, sync_status, qbo_last_updated";

const DETAIL_COLUMNS = `${LIST_COLUMNS}, billing_address, shipping_address, tax_id, notes`;

const SEARCH_COLUMNS = [
  "display_name",
  "company_name",
  "given_name",
  "family_name",
  "primary_email",
  "phone",
] as const;

export async function fetchContactList(kind: ContactKind, q: string): Promise<ContactList> {
  const supabase = await getSupabase();
  const table = tableFor(kind);
  const counted = await supabase.from(table).select("id", { count: "exact", head: true });
  if (counted.error) throw new Error(errorText(counted.error));

  let ids: string[] | null = null;
  const query = q.trim();
  if (query) {
    const pattern = likePattern(query);
    const results = await Promise.all(
      SEARCH_COLUMNS.map((column) => supabase.from(table).select("id").ilike(column, pattern)),
    );
    const found = new Set<string>();
    for (const result of results) {
      if (result.error) throw new Error(errorText(result.error));
      for (const row of result.data ?? []) found.add(String(row.id));
    }
    ids = [...found];
    if (ids.length === 0) return { rows: [], total: counted.count ?? 0 };
  }

  const rows: Contact[] = [];
  if (ids) {
    for (let index = 0; index < ids.length; index += 200) {
      const { data, error } = await supabase
        .from(table)
        .select(LIST_COLUMNS)
        .in("id", ids.slice(index, index + 200));
      if (error) throw new Error(errorText(error));
      rows.push(...(data ?? []).map((row) => toContact(row as ContactRow)));
    }
  } else {
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from(table)
        .select(LIST_COLUMNS)
        .order("display_name")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(errorText(error));
      const page = (data ?? []).map((row) => toContact(row as ContactRow));
      rows.push(...page);
      if (page.length < pageSize) break;
    }
  }

  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { rows, total: counted.count ?? rows.length };
}

export async function fetchContact(kind: ContactKind, id: string): Promise<Contact | null> {
  const { data, error } = await (await getSupabase())
    .from(tableFor(kind))
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(errorText(error));
  if (!data) return null;
  return toContact(data as ContactRow);
}

export async function createContact(kind: ContactKind, input: ContactInput): Promise<string> {
  const { data, error } = await (await getSupabase())
    .from(tableFor(kind))
    .insert({ ...toRow(input), sync_status: "local" })
    .select("id")
    .single();
  if (error) throw new Error(errorText(error));
  return String(data.id);
}

export async function updateContact(
  kind: ContactKind,
  id: string,
  input: ContactInput,
  qboId: string | null,
): Promise<void> {
  const { error } = await (await getSupabase())
    .from(tableFor(kind))
    .update({ ...toRow(input), sync_status: qboId ? "pending" : "local" })
    .eq("id", id);
  if (error) throw new Error(errorText(error));
}

type ContactRow = {
  id: string;
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
  sync_status: SyncStatus;
  qbo_last_updated: string | null;
};

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    displayName: row.display_name,
    companyName: row.company_name ?? "",
    givenName: row.given_name ?? "",
    familyName: row.family_name ?? "",
    primaryEmail: row.primary_email ?? "",
    phone: row.phone ?? "",
    billingAddress: addressOrEmpty(row.billing_address),
    shippingAddress: addressOrEmpty(row.shipping_address),
    taxId: row.tax_id ?? "",
    notes: row.notes ?? "",
    active: row.active,
    qboId: row.qbo_id,
    syncStatus: row.sync_status,
    qboLastUpdated: row.qbo_last_updated,
  };
}

function toRow(input: ContactInput) {
  return {
    display_name: input.displayName.trim(),
    company_name: emptyToNull(input.companyName),
    given_name: emptyToNull(input.givenName),
    family_name: emptyToNull(input.familyName),
    primary_email: emptyToNull(input.primaryEmail),
    phone: emptyToNull(input.phone),
    billing_address: addressOrNull(input.billingAddress),
    shipping_address: addressOrNull(input.shippingAddress),
    tax_id: emptyToNull(input.taxId),
    notes: emptyToNull(input.notes),
    active: input.active,
  };
}

function addressOrEmpty(value: PostalAddress | null | undefined): PostalAddress {
  return {
    line1: value?.line1 ?? "",
    line2: value?.line2 ?? "",
    city: value?.city ?? "",
    countrySubDivisionCode: value?.countrySubDivisionCode ?? "",
    postalCode: value?.postalCode ?? "",
    country: value?.country ?? "",
  };
}

function addressOrNull(value: PostalAddress): PostalAddress | null {
  const address = {
    line1: emptyToNull(value.line1),
    line2: emptyToNull(value.line2),
    city: emptyToNull(value.city),
    countrySubDivisionCode: emptyToNull(value.countrySubDivisionCode),
    postalCode: emptyToNull(value.postalCode),
    country: emptyToNull(value.country),
  };
  return Object.values(address).some((part) => part) ? address : null;
}

function emptyToNull(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function likePattern(raw: string): string {
  return `%${raw.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&")}%`;
}
