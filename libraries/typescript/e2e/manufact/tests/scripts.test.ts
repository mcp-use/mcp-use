import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
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

import { PACKUMENTS } from "./packuments.js";

const SCRIPTS = join(import.meta.dirname, "..", "scripts");
const execFileAsync = promisify(execFile);

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

// The npm registry and pkg.pr.new are the outside boundaries: both are faked
// with a local HTTP server; the scripts run as real processes.
describe("resolve-published.mjs", () => {
  async function serve(routes: Record<string, Buffer | string>) {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.url ?? "");
      const body = routes[req.url ?? ""];
      if (body === undefined) res.writeHead(404).end();
      else res.writeHead(200).end(body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    return {
      base: `http://127.0.0.1:${port}`,
      seen,
      close: () => new Promise<void>((r) => server.close(() => r())),
    };
  }

  // Async on purpose: the fake servers live in this process.
  const run = (argv: string[]) =>
    execFileAsync("node", [join(SCRIPTS, "resolve-published.mjs"), ...argv], {
      encoding: "utf8",
    });

  function tgz(manifest: object): Buffer {
    const dir = mkdtempSync(join(tmpdir(), "ev-e2e-tgz-"));
    mkdirSync(join(dir, "package"));
    writeFileSync(
      join(dir, "package", "package.json"),
      JSON.stringify(manifest)
    );
    execFileSync("tar", ["-czf", join(dir, "p.tgz"), "-C", dir, "package"]);
    return readFileSync(join(dir, "p.tgz"));
  }

  const stage = (bundle: string) => {
    const out = join(mkdtempSync(join(tmpdir(), "ev-e2e-out-")), "fixture");
    execFileSync("node", [
      join(SCRIPTS, "stage-fixture.mjs"),
      "--bundle",
      bundle,
      "--out",
      out,
      "--no-lock",
    ]);
    return out;
  };

  const dryRun = (argv: string[]) =>
    JSON.parse(
      execFileSync("node", [join(SCRIPTS, "deploy.mjs"), ...argv], {
        encoding: "utf8",
        env: { ...process.env, MANUFACT_TOKEN: "" },
      })
    );

  it("canary: writes a bundle that stages an exact-version fixture and a per-run deploy", async () => {
    const reg = await serve({
      "/mcp-use": JSON.stringify(PACKUMENTS["mcp-use"]),
      "/@mcp-use%2fclient": JSON.stringify(PACKUMENTS["@mcp-use/client"]),
      "/@mcp-use%2fcli": JSON.stringify(PACKUMENTS["@mcp-use/cli"]),
    });
    try {
      const bundle = mkdtempSync(join(tmpdir(), "ev-e2e-pub-"));
      await run([
        "canary",
        "--out",
        bundle,
        "--registry",
        reg.base,
        "--attempt",
        "2",
      ]);
      expect(
        JSON.parse(readFileSync(join(bundle, "combo.json"), "utf8"))
      ).toEqual({
        variant: "canary",
        source: "canary",
        tag: "canary",
        mcpUse: {
          versions: {
            "mcp-use": "2.12.10-canary.2",
            "@mcp-use/client": "2.4.7-canary.0",
            "@mcp-use/cli": "5.4.1-canary.1",
          },
          specs: {
            "mcp-use": "2.12.10-canary.2",
            "@mcp-use/client": "2.4.7-canary.0",
            "@mcp-use/cli": "5.4.1-canary.1",
          },
          integrity: {
            "mcp-use": "sha512-mcpuse",
            "@mcp-use/client": "sha512-client",
            "@mcp-use/cli": "sha512-cli1",
          },
        },
        sdk: {
          client: "2.3.1",
          core: "2.3.1",
          server: "2.3.1",
          requested: { client: "2.3.1", core: "2.3.1", server: "2.3.1" },
        },
        skipped: [
          "@mcp-use/inspector",
          "@mcp-use/events-core",
          "@mcp-use/agent",
        ],
        attempt: 2,
        extAppsPeerOverride: false,
        agentV1Sdk: null,
      });

      const out = stage(bundle);
      const manifest = JSON.parse(
        readFileSync(join(out, "package.json"), "utf8")
      );
      expect(manifest.dependencies).toEqual({
        "mcp-use": "2.12.10-canary.2",
        "@mcp-use/client": "2.4.7-canary.0",
        zod: "^4.6.6",
      });
      expect(manifest.overrides["@mcp-use/cli"]).toBe("5.4.1-canary.1");
      expect(existsSync(join(out, "vendor"))).toBe(false);

      const plan = dryRun([
        "--fixture",
        out,
        "--variant",
        "canary",
        "--run",
        "77",
        "--attempt",
        "1",
      ]);
      expect(plan.branch).toBe("r77a1-canary");
      expect(plan.message).toBe("e2e 77a1 canary 2.12.10-canary.2");
    } finally {
      await reg.close();
    }
  });

  it("pr: pins the commit's preview URLs, records tarball hashes, and deploys to the PR dev space", async () => {
    const mcpUseTgz = tgz({
      name: "mcp-use",
      version: "2.12.10",
      dependencies: {
        "@modelcontextprotocol/client": "2.3.1",
        "@modelcontextprotocol/core": "2.3.1",
        "@modelcontextprotocol/server": "2.3.1",
      },
    });
    const preview = await serve({
      "/mcp-use/mcp-use/mcp-use@abcdef0": mcpUseTgz,
      "/mcp-use/mcp-use/@mcp-use/cli@abcdef0": tgz({
        name: "@mcp-use/cli",
        version: "5.4.1",
      }),
    });
    try {
      const bundle = mkdtempSync(join(tmpdir(), "ev-e2e-pub-"));
      await run([
        "pr",
        "--ref",
        "abcdef0123456789abcdef0123456789abcdef01",
        "--out",
        bundle,
        "--preview-base",
        preview.base,
      ]);
      const combo = JSON.parse(
        readFileSync(join(bundle, "combo.json"), "utf8")
      );
      expect(combo.sha).toBe("abcdef0123456789abcdef0123456789abcdef01");
      expect(combo.mcpUse.specs).toEqual({
        "mcp-use": `${preview.base}/mcp-use/mcp-use/mcp-use@abcdef0`,
        "@mcp-use/cli": `${preview.base}/mcp-use/mcp-use/@mcp-use/cli@abcdef0`,
      });
      expect(combo.mcpUse.versions).toEqual({
        "mcp-use": "2.12.10",
        "@mcp-use/cli": "5.4.1",
      });
      expect(combo.mcpUse.tarballSha256["mcp-use"]).toBe(
        createHash("sha256").update(mcpUseTgz).digest("hex")
      );
      expect(combo.sdk.server).toBe("2.3.1");
      expect(preview.seen).toContain(
        "/mcp-use/mcp-use/@mcp-use/client@abcdef0"
      );

      const plan = dryRun([
        "--fixture",
        stage(bundle),
        "--variant",
        "pr",
        "--pr",
        "3210",
        "--run",
        "88",
      ]);
      expect(plan.branch).toBe("pr3210-pr");
      expect(plan.message).toBe("e2e 88a1 pr abcdef0");
    } finally {
      await preview.close();
    }
  });

  it("pr: exits 1 with class infra and writes nothing when the commit has no mcp-use preview", async () => {
    const preview = await serve({});
    try {
      const bundle = mkdtempSync(join(tmpdir(), "ev-e2e-pub-"));
      const err = await run([
        "pr",
        "--ref",
        "1234567",
        "--out",
        bundle,
        "--preview-base",
        preview.base,
      ]).catch((e) => e);
      expect(err.code).toBe(1);
      expect(err.stderr).toMatch(/^\[infra\] /);
      expect(existsSync(join(bundle, "combo.json"))).toBe(false);
    } finally {
      await preview.close();
    }
  });
});
