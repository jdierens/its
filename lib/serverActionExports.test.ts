import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

function serverActionFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      found.push(...serverActionFiles(path));
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    const source = readFileSync(path, "utf8");
    if (/^\s*["']use server["'];/.test(source)) found.push(path);
  }
  return found;
}

function valueExports(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^export\s+(const|let|var|function|class|enum)\b/.test(line))
    .filter((line) => !/^export\s+(async\s+function|const\s+\w+\s*=\s*async\b)/.test(line));
}

describe("use server modules", () => {
  it("exports only async functions, because Next rejects other runtime exports at build", () => {
    const offenders = serverActionFiles("lib").flatMap((path) =>
      valueExports(readFileSync(path, "utf8")).map((line) => `${path}: ${line}`),
    );
    assert.deepEqual(offenders, []);
  });
});
