import { getServiceSupabase } from "@/lib/supabaseAdmin";

export async function writeEbayLog(entry: {
  entity: "connection" | "notification" | "test";
  direction: "oauth" | "notification" | "read";
  status: "ok" | "error";
  message: string;
  detail?: Record<string, string | number | null> | null;
}): Promise<void> {
  const admin = getServiceSupabase();
  if (!admin) return;
  const now = new Date().toISOString();
  const { error } = await admin.from("ebay_sync_log").insert({
    started_at: now,
    finished_at: now,
    entity: entry.entity,
    direction: entry.direction,
    status: entry.status,
    message: entry.message.slice(0, 500),
    detail: entry.detail ?? null,
  });
  if (error) {
    console.error("ebay_sync_log insert failed", error.message);
  }
}
