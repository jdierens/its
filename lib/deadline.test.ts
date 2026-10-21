import assert from "node:assert/strict";
import test from "node:test";
import { withDeadline } from "./deadline.ts";

test("withDeadline returns the result when the work finishes in time", async () => {
  const result = await withDeadline(Promise.resolve("saved"), 200, "timed out");
  assert.equal(result, "saved");
});

test("withDeadline surfaces the work error", async () => {
  await assert.rejects(withDeadline(Promise.reject(new Error("upload failed")), 200, "timed out"), /upload failed/);
});

test("withDeadline rejects with the timeout message when the work never settles", async () => {
  await assert.rejects(withDeadline(new Promise(() => undefined), 20, "Saving the photo timed out. Try again."), {
    message: "Saving the photo timed out. Try again.",
  });
});
