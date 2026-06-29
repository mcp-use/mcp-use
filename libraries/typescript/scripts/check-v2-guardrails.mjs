#!/usr/bin/env node
/**
 * Phase 4 guardrails — fail if removed v2 paths, deps, or APIs reappear.
 *
 * Run: node scripts/check-v2-guardrails.mjs
 * Wired into CI via `pnpm knip:guardrails`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcpUsePkg = join(root, "packages", "mcp-use");
const srcDir = join(mcpUsePkg, "src");

const failures = [];

/** Paths deleted in Phase 4 — must not exist again. */
const forbiddenPaths = [
  "packages/mcp-use/src/task_managers/sse.ts",
  "packages/mcp-use/src/server/widgets",
  "packages/mcp-use/src/server/types.ts",
  "packages/mcp-use/src/server/endpoints/index.ts",
  "packages/mcp-use/tests/commonjs-compatibility.test.ts",
];

for (const rel of forbiddenPaths) {
  const abs = join(root, rel);
  if (existsSync(abs)) {
    failures.push(`Forbidden path reappeared: ${rel}`);
  }
}

/** Banned runtime dependencies in core v2 packages. */
const packageJsonPaths = [
  "packages/mcp-use/package.json",
  "packages/client/package.json",
  "packages/agent/package.json",
  "packages/cli/package.json",
];

const bannedDeps = ["@mcp-ui/server", "@mcp-ui/client"];

for (const rel of packageJsonPaths) {
  const abs = join(root, rel);
  if (!existsSync(abs)) continue;
  const pkg = JSON.parse(readFileSync(abs, "utf-8"));
  for (const bucket of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const deps = pkg[bucket];
    if (!deps) continue;
    for (const dep of bannedDeps) {
      if (deps[dep]) {
        failures.push(`${rel}: must not depend on ${dep} (${bucket})`);
      }
    }
  }
}

/** Source patterns that must not return to production code. */
const forbiddenPatterns = [
  {
    name: "createMCPServer()",
    re: /\bcreateMCPServer\s*\(/,
  },
  {
    name: "SseConnectionManager",
    re: /\bSseConnectionManager\b/,
  },
  {
    name: "SSEClientTransport",
    re: /\bSSEClientTransport\b/,
  },
  {
    name: "disableSseFallback option",
    re: /\bdisableSseFallback\b/,
  },
  {
    name: "preferSse option",
    re: /\bpreferSse\b/,
  },
  {
    name: "transportType: sse",
    re: /transportType\s*:\s*["']sse["']/,
  },
  {
    name: "legacy @modelcontextprotocol/sdk import",
    re: /from\s+["']@modelcontextprotocol\/sdk/,
  },
  {
    name: "removed samplingCallback option",
    re: /\bsamplingCallback\s*[?:]/,
  },
  {
    name: "removed elicitationCallback option",
    re: /\belicitationCallback\s*[?:]/,
  },
  {
    name: "removed MCPServer.server getter",
    re: /@deprecated Use \{\@link nativeServer\}/,
  },
];

const skipDirNames = new Set(["node_modules", "dist", ".mcp-use"]);
const skipFileRe = /(?:^|\/)(?:tests?|examples?)\//;

function walkTsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (skipDirNames.has(entry)) continue;
      walkTsFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(root, full).replace(/\\/g, "/");
    if (skipFileRe.test(rel)) continue;
    out.push(full);
  }
  return out;
}

for (const file of walkTsFiles(srcDir)) {
  const content = readFileSync(file, "utf-8");
  const rel = relative(root, file).replace(/\\/g, "/");
  for (const { name, re } of forbiddenPatterns) {
    if (re.test(content)) {
      failures.push(`${rel}: ${name}`);
    }
  }
}

/** mcp-use library packages must not ship CJS build artifacts in package exports. */
const esmOnlyPackages = [
  "packages/mcp-use",
  "packages/client",
  "packages/agent",
];
for (const rel of esmOnlyPackages) {
  const abs = join(root, rel, "package.json");
  if (!existsSync(abs)) continue;
  const pkg = JSON.parse(readFileSync(abs, "utf-8"));
  const exportsField = pkg.exports?.["."];
  if (exportsField?.require) {
    failures.push(
      `${rel}/package.json: exports["."].require must not exist (ESM-only)`
    );
  }
}

if (failures.length > 0) {
  console.error("v2 guardrails failed:\n");
  for (const line of failures) {
    console.error(`  - ${line}`);
  }
  process.exit(1);
}

console.log("v2 guardrails OK");
