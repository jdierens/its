import { getServiceSupabase } from "@/lib/supabaseAdmin";
import {
  chunkPhaseUnavailable,
  completedLogPatch,
  completedLogRow,
  inFlightLogRow,
  type ChunkLogOpen,
  type SyncLogWrite,
} from "@/lib/qbo/logShape";

export async function writeSyncLog(entry: SyncLogWrite): Promise<void> {
  const admin = getServiceSupabase();
  if (!admin) return;
  const now = new Date().toISOString();
  const row = completedLogRow(entry, now);
  const inserted = await admin.from("qbo_sync_log").insert(row);
  if (!inserted.error) return;
  if (chunkPhaseUnavailable(inserted.error.message)) {
    const { phase: _phase, ...withoutPhase } = row;
    const retry = await admin.from("qbo_sync_log").insert(withoutPhase);
    if (retry.error) console.error("qbo_sync_log insert failed", retry.error.message);
    return;
  }
  console.error("qbo_sync_log insert failed", inserted.error.message);
}

/** Insert the single row for a sync chunk. Returns null when the phase column is not applied yet. */
export async function openSyncChunk(entry: ChunkLogOpen): Promise<string | null> {
  const admin = getServiceSupabase();
  if (!admin) return null;
  const now = new Date().toISOString();
  const { data, error } = await admin.from("qbo_sync_log").insert(inFlightLogRow(entry, now)).select("id").maybeSingle();
  if (error) {
    if (!chunkPhaseUnavailable(error.message)) console.error("qbo_sync_log insert failed", error.message);
    return null;
  }
  return data && typeof data.id === "string" ? data.id : null;
}

/** Flip the open chunk row to completed. With no id, insert one completed row instead. */
export async function finishSyncChunk(id: string | null, entry: SyncLogWrite): Promise<void> {
  if (!id) {
    await writeSyncLog(entry);
    return;
  }
  const admin = getServiceSupabase();
  if (!admin) return;
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("qbo_sync_log")
    .update(completedLogPatch(entry, now))
    .eq("id", id)
    .select("id");
  if (error) {
    console.error("qbo_sync_log update failed", error.message);
    return;
  }
  if (!data || data.length === 0) await writeSyncLog(entry);
}
