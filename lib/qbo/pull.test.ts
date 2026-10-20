import assert from "node:assert/strict";
import test from "node:test";
import {
  addCounts,
  countQuery,
  formatPullProgress,
  listQuery,
  nextStart,
  pageCompletesList,
  readPullCounts,
  readTotalCount,
  recordsReached,
  runSyncRequests,
  type SyncChunk,
  type SyncPost,
} from "./pull.ts";

test("a full list is ordered by Id and read from a saved position", () => {
  assert.equal(
    listQuery("Customer", 3401),
    "select * from Customer where Active in (true, false) orderby Id startposition 3401 maxresults 100",
  );
  assert.equal(countQuery("Vendor"), "select count(*) from Vendor where Active in (true, false)");
  assert.equal(listQuery("Customer", 1).includes("orderby Id"), true);
  assert.equal(pageCompletesList(100), false);
  assert.equal(pageCompletesList(37), true);
  assert.equal(nextStart(3401, 100), 3501);
  assert.equal(recordsReached(3401, 100), 3500);
  assert.equal(recordsReached(1, 0), 0);
});

test("progress names the records already stored", () => {
  assert.equal(formatPullProgress("customer", 3500, 8102), "Customers 3,500 / 8,102");
  assert.equal(formatPullProgress("vendor", 200, null), "Vendors 200 / …");
  assert.deepEqual(addCounts({ created: 1, updated: 2, conflicts: 0, errors: 0 }, { created: 3, updated: 0, conflicts: 1, errors: 1 }), {
    created: 4,
    updated: 2,
    conflicts: 1,
    errors: 1,
  });
  assert.equal(readTotalCount({ QueryResponse: { totalCount: 3483 } }), 3483);
  assert.equal(readTotalCount({ QueryResponse: { totalCount: "12" } }), 12);
  assert.equal(readTotalCount({}), null);
  assert.deepEqual(readPullCounts({ created: 1, updated: 2, conflicts: 0, errors: 4 }), {
    created: 1,
    updated: 2,
    conflicts: 0,
    errors: 4,
  });
});

function chunk(patch: Partial<SyncChunk> = {}): SyncChunk {
  return {
    entity: "customer",
    created: 0,
    updated: 0,
    conflicts: 0,
    errors: 0,
    done: false,
    stopped: false,
    position: 200,
    total: 400,
    ...patch,
  };
}

test("the client keeps calling until the list is finished", async () => {
  const calls: string[] = [];
  const seen: string[][] = [];
  const post: SyncPost = async (body) => {
    calls.push(`${body.direction}:${body.entities.join(",")}`);
    if (body.direction === "push") {
      return { ok: true, status: 200, body: { entities: [chunk({ done: true, position: null, total: null, updated: 2 })], message: "pushed" } };
    }
    const pass = calls.filter((call) => call.startsWith("pull:")).length;
    if (pass === 1) return { ok: true, status: 200, body: { entities: [chunk({ position: 200, total: 400 })] } };
    return {
      ok: true,
      status: 200,
      body: { entities: [chunk({ done: true, position: 400, total: 400, created: 10, updated: 390 })] },
    };
  };
  const outcome = await runSyncRequests({
    entities: ["customer"],
    direction: "both",
    full: true,
    post,
    onProgress: (lines) => seen.push(lines),
  });
  assert.deepEqual(calls, ["push:customer", "pull:customer", "pull:customer"]);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.lines.at(-1), "Customers: 10 new, 390 updated, 0 errors");
  assert.equal(seen.some((lines) => lines.includes("Customers 200 / 400")), true);
});

test("a timeout is retried and a hard failure stops the loop", async () => {
  let pulls = 0;
  const post: SyncPost = async (body) => {
    if (body.direction === "pull") {
      pulls += 1;
      if (pulls === 1) return { ok: false, status: 504, body: { message: "timed out" } };
      return { ok: true, status: 200, body: { entities: [chunk({ stopped: true, position: 200 })], message: "Customer pull failed before position 201." } };
    }
    return { ok: true, status: 200, body: { entities: [] } };
  };
  const outcome = await runSyncRequests({
    entities: ["customer"],
    direction: "pull",
    full: false,
    post,
    onProgress: () => undefined,
  });
  assert.equal(pulls, 2);
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /before position 201/);
});
