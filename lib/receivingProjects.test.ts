import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RECENT_PROJECT_LIMIT,
  collectDistinctProjects,
  distinctRecentProjects,
  filterRecentProjects,
  projectChoices,
  projectScanFinished,
  projectSearchPattern,
  projectToRestore,
  readStoredProject,
  recentProjectStorageKey,
  writeStoredProject,
} from "@/lib/receivingProjects";

describe("recent receiving projects", () => {
  it("keeps the ten newest distinct names and the newest spelling", () => {
    const rows = [
      { project: "  " },
      { project: "Floor 2" },
      { project: "floor 2" },
      { project: null },
      { project: "Dock" },
      ...Array.from({ length: 12 }, (_, index) => ({ project: `Job ${index}` })),
    ];
    const names = distinctRecentProjects(rows);
    assert.equal(names.length, RECENT_PROJECT_LIMIT);
    assert.deepEqual(names.slice(0, 2), ["Floor 2", "Dock"]);
    assert.equal(names.at(-1), "Job 7");
  });

  it("filters as the clerk types and still allows a name that is not listed", () => {
    const projects = ["Floor 2", "Dock rebuild", "Office"];
    assert.deepEqual(filterRecentProjects(projects, ""), projects);
    assert.deepEqual(filterRecentProjects(projects, "  DOCK "), ["Dock rebuild"]);
    assert.deepEqual(filterRecentProjects(projects, "brand new"), []);
  });

  it("matches a project code by a case-insensitive prefix, including AZSIM6930", () => {
    const projects = ["ORHHS6229", "AZSIM6930", "AZSIM6513", "AZSIM6310", "CASC96508", "OHCCL5922"];
    assert.deepEqual(filterRecentProjects(projects, "AZ"), ["AZSIM6930", "AZSIM6513", "AZSIM6310"]);
    assert.deepEqual(filterRecentProjects(projects, "azs"), ["AZSIM6930", "AZSIM6513", "AZSIM6310"]);
    assert.deepEqual(filterRecentProjects(projects, "AZSIM6930"), ["AZSIM6930"]);
    assert.deepEqual(filterRecentProjects(projects, "ohccl"), ["OHCCL5922"]);
  });

  it("keeps a typed match that sits outside the ten most recent names", () => {
    const recent = Array.from({ length: RECENT_PROJECT_LIMIT }, (_, index) => `ORH${index}`);
    const history = ["AZSIM6930", "AZSIM6513", "CASC96508"];
    assert.deepEqual(filterRecentProjects(recent, "AZ"), []);
    assert.deepEqual(filterRecentProjects(projectChoices(history, recent), "az"), ["AZSIM6930", "AZSIM6513"]);
  });

  it("does not stop after a page filled by one project", () => {
    const busy = Array.from({ length: 4 }, () => ({ project: "ORHHS6229" }));
    const next = [
      { project: "ORHHS6229" },
      { project: "AZSIM6930" },
      { project: "AZSIM6513" },
      { project: "AZSIM6310" },
    ];
    const first = collectDistinctProjects([busy], 10, 4);
    assert.deepEqual(first, ["ORHHS6229"]);
    assert.equal(projectScanFinished(first, busy, 10, 4), false);
    const continued = collectDistinctProjects([busy, next], 10, 4);
    assert.equal(projectScanFinished(continued, next, 10, 4), false);
    assert.deepEqual(filterRecentProjects(continued, "AZ"), ["AZSIM6930", "AZSIM6513", "AZSIM6310"]);
    const tail = [{ project: "AZSIM6930" }, { project: "AZSIM6513" }, { project: "OHCCL5922" }];
    const names = collectDistinctProjects([busy, tail], 10, 4);
    assert.equal(projectScanFinished(names, tail, 10, 4), true);
    assert.deepEqual(filterRecentProjects(names, "az"), ["AZSIM6930", "AZSIM6513"]);
  });

  it("builds a contains pattern and ignores wildcard-only typing", () => {
    assert.equal(projectSearchPattern("  AZ "), "%AZ%");
    assert.equal(projectSearchPattern("azsim6930"), "%azsim6930%");
    assert.equal(projectSearchPattern("%"), null);
    assert.equal(projectSearchPattern("  "), null);
    assert.equal(projectSearchPattern("A_Z%"), "%AZ%");
  });

  it("restores this device first and the latest receipt only when storage is empty", () => {
    assert.equal(projectToRestore("Floor 2", "Dock"), "Floor 2");
    assert.equal(projectToRestore("", "Dock"), "");
    assert.equal(projectToRestore(null, "Dock"), "Dock");
    assert.equal(projectToRestore(null, null), "");
    assert.equal(recentProjectStorageKey("user-1", "JD"), "its.receiving.project.user-1");
    assert.equal(recentProjectStorageKey(null, "jd"), "its.receiving.project.JD");
    assert.equal(recentProjectStorageKey("  ", ""), "its.receiving.project.OP");
  });

  it("reads and writes localStorage without throwing when storage is blocked", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    assert.equal(readStoredProject(storage, "its.receiving.project.OP"), null);
    writeStoredProject(storage, "its.receiving.project.OP", "Floor 2");
    assert.equal(readStoredProject(storage, "its.receiving.project.OP"), "Floor 2");
    writeStoredProject(
      {
        setItem() {
          throw new Error("blocked");
        },
      },
      "its.receiving.project.OP",
      "Dock",
    );
    assert.equal(readStoredProject({ getItem: () => { throw new Error("blocked"); } }, "k"), null);
  });
});
