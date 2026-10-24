import { existsSync } from "node:fs";
import { dirname, extname, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const file = pathToFileURL(pathResolve(root, `${specifier.slice(2)}.ts`)).href;
    return nextResolve(file, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !extname(specifier) && context.parentURL) {
    const file = fileURLToPath(new URL(`${specifier}.ts`, context.parentURL));
    if (existsSync(file)) return nextResolve(pathToFileURL(file).href, context);
  }
  return nextResolve(specifier, context);
}
