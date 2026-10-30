import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkPhaseUnavailable,
  completedLogPatch,
  completedLogRow,
  inFlightLogRow,
  logPhaseLabel,
} from "./logShape.ts";

const started = "2026-10-30T15:00:00.000Z";
const finished = "2026-10-30T15:00:12.000Z";

test("a pull chunk is one row that flips from in flight to completed", () => {
  const open = inFlightLogRow(
    {
      entity: "customer",
      direction: "pull",
      message: "Customers 3,400 / 8,102. Pull is still running.",
      startedAt: started,
      detail: { position: 3400, total: 8102, startPosition: 3401 },
    },
    started,
  );
  const finish = completedLogPatch(
    {
      status: "ok",
      message: "Customers 3,600 / 8,102. Pull is still running.",
      detail: { position: 3600, total: 8102, created: 0, updated: 200, conflicts: 0, errors: 0 },
    },
    finished,
  );

  assert.equal(open.phase, "in_flight");
  assert.equal(open.status, "in_flight");
  assert.equal(open.finished_at, null);
  assert.equal(open.started_at, started);
  assert.equal(open.message, "Customers 3,400 / 8,102. Pull is still running.");

  assert.deepEqual(Object.keys(finish).sort(), ["detail", "finished_at", "message", "phase", "status"]);
  assert.equal(finish.phase, "completed");
  assert.equal(finish.status, "ok");
  assert.equal(finish.finished_at, finished);
  assert.equal(finish.message, "Customers 3,600 / 8,102. Pull is still running.");
  assert.equal(logPhaseLabel({ phase: open.phase, status: open.status, finishedAt: open.finished_at }), "In flight");
  assert.equal(logPhaseLabel({ phase: finish.phase, status: finish.status, finishedAt: finish.finished_at }), "Completed");
});

test("a failed chunk completes the same row as an error", () => {
  const finish = completedLogPatch(
    {
      status: "error",
      message: "Customer pull failed before position 3401. Run sync again to continue. QuickBooks timed out.",
    },
    finished,
  );
  assert.equal(finish.phase, "completed");
  assert.equal(finish.status, "error");
  assert.equal(finish.finished_at, finished);
});

test("a one-shot log is inserted already completed", () => {
  const row = completedLogRow(
    {
      entity: "connection",
      direction: "oauth",
      status: "ok",
      message: "Connected QuickBooks company 1.",
      startedAt: started,
    },
    finished,
  );
  assert.equal(row.phase, "completed");
  assert.equal(row.status, "ok");
  assert.equal(row.finished_at, finished);
  assert.equal(logPhaseLabel({ phase: null, status: "ok", finishedAt: finished }), "Completed");
});

test("missing phase column or the old status check is the pre-migration case", () => {
  assert.equal(
    chunkPhaseUnavailable("Could not find the 'phase' column of 'qbo_sync_log' in the schema cache"),
    true,
  );
  assert.equal(
    chunkPhaseUnavailable(
      'new row for relation "qbo_sync_log" violates check constraint "qbo_sync_log_status_known"',
    ),
    true,
  );
  assert.equal(chunkPhaseUnavailable("permission denied for table qbo_sync_log"), false);
});
