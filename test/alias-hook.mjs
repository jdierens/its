import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const file = pathToFileURL(pathResolve(root, `${specifier.slice(2)}.ts`)).href;
    return nextResolve(file, context);
  }
  return nextResolve(specifier, context);
}
