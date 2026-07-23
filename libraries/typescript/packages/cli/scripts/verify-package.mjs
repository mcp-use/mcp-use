import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = walk(join(root, "dist"));

if (!files.includes("dist/bin.js")) throw new Error("Missing dist/bin.js");
if (!files.includes("dist/index.js")) throw new Error("Missing dist/index.js");
if (files.some((file) => file.endsWith(".map"))) {
  throw new Error("CLI package must not publish source maps");
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    return entry.isDirectory()
      ? walk(absolute)
      : entry.isFile()
        ? [relative(root, absolute)]
        : [];
  });
}
