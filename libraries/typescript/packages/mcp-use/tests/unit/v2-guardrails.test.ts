/**
 * Phase 4 regression guardrails — mirrors scripts/check-v2-guardrails.mjs.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const monorepoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);
const scriptPath = join(monorepoRoot, "scripts", "check-v2-guardrails.mjs");

describe("v2 guardrails", () => {
  it("check-v2-guardrails.mjs passes", () => {
    expect(existsSync(scriptPath), scriptPath).toBe(true);
    const out = execFileSync(process.execPath, [scriptPath], {
      cwd: monorepoRoot,
      encoding: "utf-8",
    });
    expect(out.trim()).toBe("v2 guardrails OK");
  });
});
