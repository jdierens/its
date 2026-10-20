import assert from "node:assert/strict";
import test from "node:test";
import { applyBump, parseBump, releaseVersion } from "./releaseVersion.ts";

test("minor resets the patch and patch adds one", () => {
  assert.equal(applyBump("0.21.0", "minor"), "0.22.0");
  assert.equal(applyBump("0.21.0", "patch"), "0.21.1");
  assert.equal(applyBump("0.22.0", "patch"), "0.22.1");
});

test("changes files apply in filename order on top of package.json", () => {
  const version = releaseVersion("0.21.0", [
    { name: "20261020020000-bins.md", bump: "minor" },
    { name: "20261020010000-notes.md", bump: "patch" },
  ]);
  assert.equal(version, "0.22.0");
  assert.equal(releaseVersion("0.21.0", []), "0.21.0");
});

test("a changes file says bump minor or bump patch", () => {
  assert.equal(parseBump("---\nbump: minor\n---\n- Added bins.\n"), "minor");
  assert.equal(parseBump("bump: patch\n"), "patch");
  assert.throws(() => parseBump("- no bump\n"), /bump: minor or bump: patch/);
});
