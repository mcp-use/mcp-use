/**
 * Regression test for https://github.com/mcp-use/mcp-use/issues/1371
 *
 * Ensures @mcp-use/inspector does NOT pull in langchain (either at the
 * `package.json` dependency level, or as a static import in its built
 * `dist/**` JavaScript). Any `@langchain/*`, `langchain`, or `MCPAgent`
 * reference reaching the inspector's dist would re-break consumers of
 * `mcp-use` who do not install langchain (e.g., Next.js apps).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve to the inspector package inside the mcp-use workspace.
const inspectorPkgDir = join(__dirname, "..", "..", "inspector");

describe("@mcp-use/inspector must not require langchain", () => {
  it("package.json declares no @langchain/* or langchain dependency", () => {
    const pkgJsonPath = join(inspectorPkgDir, "package.json");
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const banned = [
      "@langchain/core",
      "@langchain/openai",
      "@langchain/anthropic",
      "@langchain/google-genai",
      "langchain",
    ];
    const buckets: Array<[string, Record<string, string> | undefined]> = [
      ["dependencies", pkgJson.dependencies],
      ["peerDependencies", pkgJson.peerDependencies],
      ["optionalDependencies", pkgJson.optionalDependencies],
    ];
    for (const [name, bucket] of buckets) {
      if (!bucket) continue;
      for (const dep of banned) {
        expect(
          bucket[dep],
          `@mcp-use/inspector package.json must not list ${dep} in ${name}`
        ).toBeUndefined();
      }
    }
  });

  it("built dist/ has no static langchain or MCPAgent references", () => {
    const distDir = join(inspectorPkgDir, "dist");
    let files: string[] = [];
    try {
      files = collectJsFiles(distDir);
    } catch {
      // No dist yet (fresh checkout) — nothing to check.
      return;
    }
    if (files.length === 0) return;

    const forbiddenPatterns: Array<{ name: string; re: RegExp }> = [
      {
        name: "static @langchain/* import",
        re: /(?:^|[^a-zA-Z0-9_])from\s*["']@langchain\//m,
      },
      {
        name: "static langchain import",
        re: /(?:^|[^a-zA-Z0-9_])from\s*["']langchain["']/m,
      },
      {
        name: "@langchain/* require",
        re: /require\(\s*["']@langchain\//,
      },
      {
        name: "langchain require",
        re: /require\(\s*["']langchain["']\)/,
      },
      {
        name: "dynamic import('@langchain/*')",
        re: /import\(\s*["']@langchain\//,
      },
      {
        name: "dynamic import('langchain')",
        re: /import\(\s*["']langchain["']\)/,
      },
      {
        name: "MCPAgent reference",
        re: /\bMCPAgent\b/,
      },
    ];

    const failures: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const { name, re } of forbiddenPatterns) {
        if (re.test(content)) {
          failures.push(`${name} found in ${relative(file)}`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

function collectJsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (/\.(m?js|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function relative(p: string): string {
  return p.replace(inspectorPkgDir + "/", "");
}
