import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS = join(import.meta.dirname, "..", "scripts");

function fakeBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "ev-e2e-bundle-"));
  mkdirSync(join(dir, "vendor"));
  for (const f of ["mcp-use.tgz", "mcp-use-client.tgz", "mcp-use-cli.tgz"])
    writeFileSync(join(dir, "vendor", f), "x");
  writeFileSync(
    join(dir, "combo.json"),
    JSON.stringify({
      sha: "0123456789abcdef",
      variant: "pinned",
      mcpUse: {
        versions: {
          "mcp-use": "2.12.9",
          "@mcp-use/client": "1.0.0",
          "@mcp-use/cli": "3.0.0",
        },
        tarballSha256: {},
      },
      sdk: {
        server: "2.3.1",
        client: "2.3.1",
        core: "2.3.1",
        requested: { server: "2.3.1" },
      },
      patch: "patches/sdk/2.3.1.patch",
      extAppsPeerOverride: false,
    })
  );
  writeFileSync(join(dir, "sdk-variant.json"), "{}");
  return dir;
}

describe("stage-fixture.mjs", () => {
  it("writes the vendored manifest, omit.json and the fixture source, dropping packages the build lacks", () => {
    const out = join(mkdtempSync(join(tmpdir(), "ev-e2e-out-")), "fixture");
    execFileSync("node", [
      join(SCRIPTS, "stage-fixture.mjs"),
      "--bundle",
      fakeBundle(),
      "--out",
      out,
      "--omit",
      "note.deleted",
      "--no-lock",
    ]);
    expect(JSON.parse(readFileSync(join(out, "package.json"), "utf8"))).toEqual(
      {
        name: "ev-e2e-fixture",
        private: true,
        type: "module",
        engines: { node: ">=22.22.2" },
        scripts: { build: "mcp-use build", start: "mcp-use start" },
        dependencies: {
          "mcp-use": "file:./vendor/mcp-use.tgz",
          "@mcp-use/client": "file:./vendor/mcp-use-client.tgz",
          zod: "^4.6.6",
        },
        overrides: {
          "mcp-use": "$mcp-use",
          "@mcp-use/client": "$@mcp-use/client",
          "@mcp-use/cli": "file:./vendor/mcp-use-cli.tgz",
          "@modelcontextprotocol/client": "2.3.1",
          "@modelcontextprotocol/core": "2.3.1",
          "@modelcontextprotocol/server": "2.3.1",
        },
      }
    );
    expect(JSON.parse(readFileSync(join(out, "omit.json"), "utf8"))).toEqual([
      "note.deleted",
    ]);
    expect(existsSync(join(out, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(out, "vendor", "mcp-use.tgz"))).toBe(true);
  });
});

describe("deploy.mjs", () => {
  it("without --execute prints the plan and calls nothing", () => {
    const out = join(mkdtempSync(join(tmpdir(), "ev-e2e-out-")), "fixture");
    execFileSync("node", [
      join(SCRIPTS, "stage-fixture.mjs"),
      "--bundle",
      fakeBundle(),
      "--out",
      out,
      "--no-lock",
    ]);
    const plan = JSON.parse(
      execFileSync(
        "node",
        [
          join(SCRIPTS, "deploy.mjs"),
          "--fixture",
          out,
          "--variant",
          "pinned",
          "--run",
          "42",
          "--attempt",
          "2",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, MANUFACT_TOKEN: "" },
        }
      )
    );
    expect(plan.dryRun).toBe(true);
    expect(plan.branch).toBe("r42a2-pinned");
    expect(plan.message).toBe("e2e 42a2 pinned 0123456");
    expect(plan.argv.slice(0, 9)).toEqual([
      "deploy",
      ".",
      "--server",
      "ev-e2e-app",
      "--branch",
      "r42a2-pinned",
      "--no-github",
      "--json",
      "--yes",
    ]);
  });
});
