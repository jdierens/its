import assert from "node:assert/strict";
import test from "node:test";
import { selectedExportIds } from "./load.ts";

const ID = "11111111-1111-4111-8111-111111111111";

test("selected export ids keep unique uuids and drop anything else", () => {
  assert.deepEqual(selectedExportIds(undefined), []);
  assert.deepEqual(selectedExportIds([]), []);
  assert.deepEqual(
    selectedExportIds([` ${ID} `, ID, "not-a-uuid", "22222222-2222-4222-8222-222222222222"]),
    [ID, "22222222-2222-4222-8222-222222222222"],
  );
});
