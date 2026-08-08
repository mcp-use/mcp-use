#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const ignored = new Set([
  ".git",
  ".mcp-use",
  ".agents",
  ".agent",
  ".claude",
  ".cursor",
  "dist",
  "node_modules",
]);
const extensions = new Set([".js", ".jsx", ".md", ".mdx", ".ts", ".tsx"]);
const checks = [
  [/from\s+["']mcp-use\/server["']/g, "import server APIs from mcp-use"],
  [
    /\buseWidget\s*\(/g,
    "replace useWidget with useToolContext and focused hooks",
  ],
  [/\bMcpUseProvider\b/g, "remove the retired McpUseProvider wrapper"],
  [
    /\bwidget\s*\(/g,
    "return content and structuredContent instead of widget()",
  ],
  [
    /resources\/[A-Za-z0-9_-]+\/widget\.tsx/g,
    "move Views to views/<name>/view.tsx",
  ],
];

const findings = [];
for (const file of walk(root)) {
  const text = readFileSync(file, "utf8");
  for (const [pattern, guidance] of checks) {
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push(
        `${relative(root, file)}:${line}: ${match[0]} — ${guidance}`,
      );
    }
  }
}

if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("No retired mcp-use v1 patterns found.");
}

function* walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const file = resolve(directory, entry);
    const stats = statSync(file);
    if (stats.isDirectory()) {
      yield* walk(file);
      continue;
    }
    const dot = entry.lastIndexOf(".");
    if (dot !== -1 && extensions.has(entry.slice(dot))) yield file;
  }
}
