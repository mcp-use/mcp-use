import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = walk(join(root, "dist"));

if (!files.includes(join("dist", "bin.js"))) {
  throw new Error("Missing dist/bin.js");
}
if (!files.includes(join("dist", "index.js"))) {
  throw new Error("Missing dist/index.js");
}
const bundledLicenses = new Map([
  ["modelcontextprotocol-server-LICENSE", ["Apache License", "MIT License"]],
  ["modelcontextprotocol-core-LICENSE", ["Apache License", "MIT License"]],
  ["zod-LICENSE", ["MIT License"]],
]);
for (const [filename, expectedTerms] of bundledLicenses) {
  const license = join("dist", "third-party-licenses", filename);
  if (!files.includes(license)) {
    throw new Error(`Missing ${license} for bundled dependency code`);
  }
  const licenseText = readFileSync(join(root, license), "utf8");
  if (expectedTerms.some((term) => !licenseText.includes(term))) {
    throw new Error(`${license} does not contain the expected license terms`);
  }
}
if (!existsSync(join(root, "types", "vite-client.d.ts"))) {
  throw new Error("Missing types/vite-client.d.ts");
}
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
