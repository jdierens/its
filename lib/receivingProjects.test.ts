import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RECENT_PROJECT_LIMIT,
  distinctRecentProjects,
  filterRecentProjects,
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
