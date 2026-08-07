import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const files = walk(dist);
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (Object.keys(manifest.dependencies ?? {}).length !== 0) {
  throw new Error(
    "Inspector package must not install framework runtime dependencies"
  );
}
for (const peer of ["@mcp-use/client", "@mcp-use/agent"]) {
  if (manifest.peerDependencies?.[peer] === undefined) {
    throw new Error(`Missing framework peer declaration: ${peer}`);
  }
  if (manifest.peerDependenciesMeta?.[peer]?.optional !== true) {
    throw new Error(`Framework peer must be optional: ${peer}`);
  }
}
for (const file of files) {
  if (
    file.startsWith("dist/web/") ||
    file.endsWith(".map") ||
    file === "dist/app/inspector.js" ||
    file === "dist/app/inspector.css"
  ) {
    throw new Error(`Inspector package contains forbidden output: ${file}`);
  }
}

for (const required of [
  "dist/server/index.js",
  "dist/server/index.d.ts",
  "dist/client/index.js",
  "dist/client/index.d.ts",
  "dist/cli.js",
  "dist/app/inspector.js.gz",
  "dist/app/inspector.css.gz",
]) {
  if (!files.includes(required)) throw new Error(`Missing ${required}`);
}

const appJavaScript = gunzipSync(
  readFileSync(join(dist, "app/inspector.js.gz"))
).toString("utf8");
if (!appJavaScript.includes(manifest.version)) {
  throw new Error(`Inspector app is not stamped with ${manifest.version}`);
}

const cli = readFileSync(join(dist, "cli.js"), "utf8");
if (!cli.startsWith("#!/usr/bin/env node\n") || cli.indexOf("#!", 2) !== -1) {
  throw new Error("Inspector CLI must contain exactly one leading shebang");
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    if (!entry.isFile()) return [];
    return [relative(root, absolute).split(sep).join("/")];
  });
}
