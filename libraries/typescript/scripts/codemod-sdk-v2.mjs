#!/usr/bin/env node
/**
 * Mechanical import rewrite: @modelcontextprotocol/sdk v1 → server/client v2.
 * Run from libraries/typescript: node scripts/codemod-sdk-v2.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(root, "packages");

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(abs, out);
    } else if (EXT.has(path.extname(name))) {
      out.push(abs);
    }
  }
  return out;
}

function listFiles() {
  const files = [];
  for (const pkg of readdirSync(packagesDir)) {
    walk(path.join(packagesDir, pkg), files);
  }
  return files.filter((f) =>
    readFileSync(f, "utf8").includes("@modelcontextprotocol/sdk")
  );
}

const EXACT_MAP = new Map([
  ["@modelcontextprotocol/sdk/server/mcp.js", "@modelcontextprotocol/server"],
  [
    "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js",
    "@modelcontextprotocol/server",
  ],
  [
    "@modelcontextprotocol/sdk/server/completable.js",
    "@modelcontextprotocol/server",
  ],
  [
    "@modelcontextprotocol/sdk/server/zod-compat.js",
    "@modelcontextprotocol/server",
  ],
  [
    "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js",
    "@modelcontextprotocol/server",
  ],
  ["@modelcontextprotocol/sdk/server/index.js", "@modelcontextprotocol/server"],
  [
    "@modelcontextprotocol/sdk/server/stdio.js",
    "@modelcontextprotocol/server/stdio",
  ],
  ["@modelcontextprotocol/sdk/client/index.js", "@modelcontextprotocol/client"],
  [
    "@modelcontextprotocol/sdk/client/streamableHttp.js",
    "@modelcontextprotocol/client",
  ],
  [
    "@modelcontextprotocol/sdk/client/stdio.js",
    "@modelcontextprotocol/client/stdio",
  ],
  ["@modelcontextprotocol/sdk/client/sse.js", "@modelcontextprotocol/client"],
  ["@modelcontextprotocol/sdk/client/auth.js", "@modelcontextprotocol/client"],
  ["@modelcontextprotocol/sdk/shared/auth.js", "@modelcontextprotocol/client"],
  [
    "@modelcontextprotocol/sdk/shared/protocol.js",
    "@modelcontextprotocol/client",
  ],
  ["@modelcontextprotocol/sdk", "@modelcontextprotocol/client"],
]);

function isServerSide(filePath) {
  return (
    /[/\\]server[/\\]/.test(filePath) ||
    /[/\\]tests[/\\]servers[/\\]/.test(filePath) ||
    /[/\\]examples[/\\]server[/\\]/.test(filePath) ||
    /mount-mcp/.test(filePath) ||
    /distributed-stream-routing/.test(filePath)
  );
}

function resolveTypesTarget(filePath) {
  return isServerSide(filePath)
    ? "@modelcontextprotocol/server"
    : "@modelcontextprotocol/client";
}

function resolveTransportTarget(filePath) {
  return isServerSide(filePath)
    ? "@modelcontextprotocol/server"
    : "@modelcontextprotocol/client";
}

function rewriteSpec(spec, filePath) {
  if (EXACT_MAP.has(spec)) return EXACT_MAP.get(spec);
  if (spec === "@modelcontextprotocol/sdk/types.js") {
    return resolveTypesTarget(filePath);
  }
  if (spec === "@modelcontextprotocol/sdk/shared/transport.js") {
    return resolveTransportTarget(filePath);
  }
  return spec;
}

function transform(content, filePath) {
  let out = content;
  out = out.replace(
    /(["'])@modelcontextprotocol\/sdk[^"']*\1/g,
    (match, quote) => {
      const spec = match.slice(1, -1);
      const next = rewriteSpec(spec, filePath);
      return `${quote}${next}${quote}`;
    }
  );
  return out;
}

const files = listFiles();

let changed = 0;
for (const abs of files) {
  const rel = path.relative(root, abs);
  const before = readFileSync(abs, "utf8");
  const after = transform(before, abs);
  if (after !== before) {
    writeFileSync(abs, after);
    changed++;
    console.log("updated:", rel);
  }
}

console.log(`\nDone: ${changed}/${files.length} files updated.`);
