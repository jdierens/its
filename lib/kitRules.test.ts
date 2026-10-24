import assert from "node:assert/strict";
import test from "node:test";
import { genericStillNeedsPart, keepKitName, kitFieldDefaults } from "./kitRules.ts";

test("kit names keep slashes", () => {
  const name = "DL360G10-S8/CSRF90_2/S240_2/M32R4_16/R408/P80_2/_K";
  assert.equal(keepKitName(`  ${name}  `), name);
  assert.equal(keepKitName(name).includes("\\"), false);
});

test("product names keep backslashes", () => {
  const name = "MEM\\PC4-2400T-R\\32G\\2Rx4";
  assert.equal(keepKitName(`  ${name}  `), name);
  assert.equal(name.includes("/"), false);
});

test("a server kit takes condition from its one chassis and the server ECCN", () => {
  const defaults = kitFieldDefaults("KIT/SRV", [
    { id: "cpu", longCode: "CPU/PRC", condition: "New", eccn: "3A001" },
    { id: "chassis", longCode: "CHA/SRV", condition: "Used", eccn: "5A002" },
  ]);
  assert.equal(defaults.condition, "Used");
  assert.equal(defaults.eccn, "5A992.C");
  assert.equal(defaults.needsChoice, false);
});

test("a server kit asks for a condition when the chassis is missing or repeated", () => {
  const none = kitFieldDefaults("KIT/SRV", [
    { id: "cpu", longCode: "CPU/PRC", condition: "New", eccn: "3A001" },
  ]);
  assert.equal(none.needsChoice, true);
  assert.equal(none.eccn, "5A992.C");
  const two = kitFieldDefaults("KIT/SRV", [
    { id: "a", longCode: "SYS/SRV", condition: "New", eccn: "5A992.C" },
    { id: "b", longCode: "CHA/1U", condition: "Used", eccn: "5A992.C" },
  ]);
  assert.equal(two.needsChoice, true);
  assert.equal(two.condition, null);
});

test("a bundle copies condition and ECCN from its only child", () => {
  const defaults = kitFieldDefaults("KIT/BDL", [
    { id: "cpu", longCode: "CPU/PRC", condition: "New", eccn: "3A001" },
  ]);
  assert.equal(defaults.condition, "New");
  assert.equal(defaults.eccn, "3A001");
  assert.match(kitFieldDefaults("KIT/BDL", []).message ?? "", /exactly one/);
});

test("a generic component still needs a physical part", () => {
  assert.equal(genericStillNeedsPart({ plannedGeneric: true, hasActual: false, actualGeneric: null }), true);
  assert.equal(genericStillNeedsPart({ plannedGeneric: true, hasActual: true, actualGeneric: true }), true);
  assert.equal(genericStillNeedsPart({ plannedGeneric: true, hasActual: true, actualGeneric: false }), false);
  assert.equal(genericStillNeedsPart({ plannedGeneric: false, hasActual: false, actualGeneric: null }), false);
  assert.equal(genericStillNeedsPart({ plannedGeneric: false, hasActual: true, actualGeneric: true }), true);
});
