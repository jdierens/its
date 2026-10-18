import { getServiceSupabase } from "@/lib/supabaseAdmin";

export async function writeSyncLog(entry: {
  entity: "customer" | "vendor" | "connection" | "sync";
  direction: "pull" | "push" | "oauth";
  status: "ok" | "error";
  message: string;
  detail?: Record<string, string | number | null> | null;
  startedAt?: string;
}): Promise<void> {
  const admin = getServiceSupabase();
  if (!admin) return;
  const now = new Date().toISOString();
  const { error } = await admin.from("qbo_sync_log").insert({
    started_at: entry.startedAt ?? now,
    finished_at: now,
    entity: entry.entity,
    direction: entry.direction,
    status: entry.status,
    message: entry.message.slice(0, 500),
    detail: entry.detail ?? null,
  });
  if (error) {
    console.error("qbo_sync_log insert failed", error.message);
  }
}
