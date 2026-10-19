import assert from "node:assert/strict";
import test from "node:test";
import {
  appendSortStart,
  moveItem,
  orderByCreatedAt,
  primaryStoragePath,
  shiftedSortOrders,
  sortOrderAfterSource,
} from "./imageOrder.ts";

test("moving a photo left or right changes which one is first", () => {
  const photos = ["a", "b", "c"];
  assert.deepEqual(moveItem(photos, 1, 0), ["b", "a", "c"]);
  assert.deepEqual(moveItem(photos, 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(photos, 0, 0), photos);
  assert.deepEqual(moveItem(photos, 0, -1), photos);
  assert.deepEqual(moveItem(photos, 2, 3), photos);
});

test("new uploads start after the highest sort order", () => {
  assert.equal(appendSortStart([]), 0);
  assert.equal(appendSortStart([0, 2, 1]), 3);
});

test("an edited photo is inserted immediately after its original", () => {
  const images = [
    { id: "original", sortOrder: 0 },
    { id: "next", sortOrder: 1 },
    { id: "last", sortOrder: 4 },
  ];
  const insertAt = sortOrderAfterSource(images, "original");
  assert.equal(insertAt, 1);
  assert.deepEqual(shiftedSortOrders(images, insertAt), [
    { id: "last", sortOrder: 5 },
    { id: "next", sortOrder: 2 },
  ]);
  assert.equal(sortOrderAfterSource(images, "missing"), 5);
});

test("created time decides the backfilled order and the first photo is primary", () => {
  const ordered = orderByCreatedAt([
    { id: "later", createdAt: "2026-10-18T22:39:47Z" },
    { id: "edited", createdAt: "2026-10-18T22:40:57Z" },
    { id: "earlier", createdAt: "2026-10-18T22:38:01Z" },
  ]);
  assert.deepEqual(
    ordered.map((image) => image.id),
    ["earlier", "later", "edited"],
  );
  assert.equal(
    primaryStoragePath([
      { storage_path: "item/later.jpg", sort_order: 1 },
      { storage_path: "item/earlier.jpg", sort_order: 0 },
    ]),
    "item/earlier.jpg",
  );
  assert.equal(primaryStoragePath([]), null);
});
