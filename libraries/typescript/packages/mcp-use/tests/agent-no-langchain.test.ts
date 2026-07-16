/**
 * Ensures @mcp-use/agent main entry does NOT pull in langchain.
 * LangChain lives only in @mcp-use/agent/langchain.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const agentPkgDir = join(__dirname, "..", "..", "agent");

describe("@mcp-use/agent main entry must not require langchain", () => {
  it("package.json lists langchain peers as optional only", () => {
    const pkgJson = JSON.parse(
      readFileSync(join(agentPkgDir, "package.json"), "utf-8")
    );
    expect(pkgJson.peerDependenciesMeta?.langchain?.optional).toBe(true);
    expect(pkgJson.peerDependenciesMeta?.["@langchain/core"]?.optional).toBe(
      true
    );
  });

  it("dist/index.js has no static langchain imports", () => {
    const mainDist = join(agentPkgDir, "dist", "index.js");
    let content: string;
    try {
      content = readFileSync(mainDist, "utf-8");
    } catch {
      return;
    }
    expect(content).not.toMatch(/from\s*["']@langchain\//);
    expect(content).not.toMatch(/from\s*["']langchain["']/);
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
