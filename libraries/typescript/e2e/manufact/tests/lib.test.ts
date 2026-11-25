import { describe, expect, it } from "vitest";
// @ts-ignore -- plain ESM script module
import {
  branchName,
  checkLockfile,
  commitMessage,
  compareIdentity,
  deployArgv,
  deriveSecrets,
  isJanitorBranch,
  janitorSelect,
  nsHash,
} from "../scripts/lib.mjs";

describe("naming", () => {
  it("builds r<run>a<attempt>-<variant> and w-prefixed weekly branches", () => {
    expect(
      branchName({ runId: "123456789", attempt: "2", variant: "pinned" })
    ).toBe("r123456789a2-pinned");
    expect(
      branchName({ runId: 7, attempt: 1, variant: "latest", weekly: true })
    ).toBe("w7a1-latest");
  });

  it("rejects branches over 40 characters", () => {
    expect(() =>
      branchName({ runId: "1".repeat(30), attempt: "1", variant: "prerelease" })
    ).toThrow();
  });

  it("janitor matches r-branches only", () => {
    expect(isJanitorBranch("r12a1-pinned")).toBe(true);
    expect(isJanitorBranch("w12a1-pinned")).toBe(false);
    expect(isJanitorBranch("main")).toBe(false);
  });

  it("commit message carries run, attempt, variant and sha7", () => {
    expect(
      commitMessage({
        runId: 9,
        attempt: 3,
        variant: "pr-3209",
        sha: "abcdef0123456789",
      })
    ).toBe("e2e 9a3 pr-3209 abcdef0");
  });
});

describe("deriveSecrets", () => {
  it("is deterministic per run, attempt and variant and differs across attempts", () => {
    const a = deriveSecrets({
      seed: "seed",
      runId: 1,
      attempt: 1,
      variant: "pinned",
    });
    const again = deriveSecrets({
      seed: "seed",
      runId: 1,
      attempt: 1,
      variant: "pinned",
    });
    const retry = deriveSecrets({
      seed: "seed",
      runId: 1,
      attempt: 2,
      variant: "pinned",
    });
    expect(again).toEqual(a);
    expect(retry.adminSecret).not.toBe(a.adminSecret);
    expect(a.webhookSecrets).toHaveLength(2);
    expect(a.webhookSecrets[0]).toMatch(/^whsec_e2e_[0-9a-f]{64}$/);
    expect(a.webhookSecrets[0]).not.toBe(a.webhookSecrets[1]);
  });

  it("refuses to run without a seed", () => {
    expect(() =>
      deriveSecrets({ seed: "", runId: 1, attempt: 1, variant: "pinned" })
    ).toThrow("E2E_SECRET_SEED");
  });
});

describe("nsHash", () => {
  it("is 16 base64url characters of SHA-256 of the namespace", () => {
    // SHA-256("abc") = ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0 in base64url.
    expect(nsHash("abc")).toBe("ungWv48Bz-pBQUDe");
  });
});

describe("R3a checkLockfile", () => {
  const good = {
    packages: {
      "": {},
      "node_modules/mcp-use": {
        version: "2.12.9",
        resolved: "file:vendor/mcp-use.tgz",
      },
      "node_modules/@mcp-use/client": {
        version: "1.0.0",
        resolved: "file:vendor/mcp-use-client.tgz",
      },
      "node_modules/@mcp-use/events-core": {
        version: "0.1.0",
        resolved: "file:vendor/mcp-use-events-core.tgz",
      },
      "node_modules/@modelcontextprotocol/server": {
        version: "2.3.1",
        resolved:
          "https://registry.npmjs.org/@modelcontextprotocol/server/-/server-2.3.1.tgz",
      },
    },
  };

  it("passes when mcp-use packages come from vendor/ and the SDK matches", () => {
    expect(checkLockfile(good, { sdk: "2.3.1" })).toEqual([]);
  });

  it("fails an mcp-use package resolved from the npm registry", () => {
    const lock = structuredClone(good);
    lock.packages["node_modules/mcp-use"].resolved =
      "https://registry.npmjs.org/mcp-use/-/mcp-use-2.12.9.tgz";
    expect(checkLockfile(lock, { sdk: "2.3.1" })).toEqual([
      {
        code: "MCP_USE_NOT_VENDORED",
        name: "mcp-use",
        path: "node_modules/mcp-use",
        resolved: "https://registry.npmjs.org/mcp-use/-/mcp-use-2.12.9.tgz",
      },
    ]);
  });

  it("fails an SDK copy at another version, nested ones included", () => {
    const lock = structuredClone(good);
    (lock.packages as Record<string, unknown>)[
      "node_modules/x/node_modules/@modelcontextprotocol/server"
    ] = { version: "2.4.0" };
    expect(checkLockfile(lock, { sdk: "2.3.1" })).toEqual([
      {
        code: "SDK_MISMATCH",
        name: "@modelcontextprotocol/server",
        path: "node_modules/x/node_modules/@modelcontextprotocol/server",
        want: "2.3.1",
        got: "2.4.0",
      },
    ]);
  });

  it("checks tarball URL variants by resolved URL", () => {
    const url = "https://pkg.pr.new/@modelcontextprotocol/server@abc1234";
    const lock = structuredClone(good);
    lock.packages["node_modules/@modelcontextprotocol/server"] = {
      version: "2.5.0-pr",
      resolved: url,
    };
    expect(
      checkLockfile(lock, { sdk: { server: url, client: url, core: url } })
    ).toEqual([]);
  });

  it("reports a direct dependency missing from the lockfile", () => {
    const lock = structuredClone(good);
    delete (lock.packages as Record<string, unknown>)[
      "node_modules/@mcp-use/events-core"
    ];
    expect(checkLockfile(lock, { sdk: "2.3.1" })).toEqual([
      { code: "MCP_USE_MISSING", name: "@mcp-use/events-core" },
    ]);
  });
});

describe("compareIdentity (E0)", () => {
  const combo = {
    sha: "c0ffee",
    sdk: { server: "2.3.1", bundledHash: "h1" },
    patch: "patches/sdk/2.3.1.patch",
  };

  it("is empty when the server reports the combo", () => {
    expect(
      compareIdentity(combo, {
        build: { sha: "c0ffee" },
        sdk: {
          bundled: "2.3.1",
          bundledHash: "h1",
          external: "2.3.1",
          patchedPredicate: true,
        },
      })
    ).toEqual([]);
  });

  it("names every field that differs, hashes included", () => {
    expect(
      compareIdentity(combo, {
        build: { sha: "c0ffee" },
        sdk: {
          bundled: "2.3.1",
          bundledHash: "h2",
          external: "2.4.0",
          patchedPredicate: true,
        },
      })
    ).toEqual([
      { field: "sdk.bundledHash", want: "h1", got: "h2" },
      { field: "sdk.external", want: "2.3.1", got: "2.4.0" },
    ]);
  });
});

describe("janitorSelect", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  const deployments = [
    {
      id: "old-r",
      serverId: "srv",
      branch: "r1a1-pinned",
      createdAt: "2026-11-25T05:00:00Z",
    },
    {
      id: "new-r",
      serverId: "srv",
      branch: "r2a1-pinned",
      createdAt: "2026-11-25T11:00:00Z",
    },
    {
      id: "old-w",
      serverId: "srv",
      branch: "w1a1-pinned",
      createdAt: "2026-11-20T00:00:00Z",
    },
    {
      id: "other",
      serverId: "srv2",
      branch: "r1a1-pinned",
      createdAt: "2026-11-20T00:00:00Z",
    },
    {
      id: "main",
      serverId: "srv",
      branch: "main",
      createdAt: "2026-11-20T00:00:00Z",
    },
  ];
  it("selects only old r-branches of the e2e server", () => {
    expect(
      janitorSelect(deployments, {
        serverId: "srv",
        now,
        maxAgeMs: 6 * 3600_000,
      }).map((d: { id: string }) => d.id)
    ).toEqual(["old-r"]);
  });
});

describe("deployArgv", () => {
  it("deploys to the branch without GitHub, as JSON, with the commit message", () => {
    expect(
      deployArgv({
        fixtureDir: ".",
        server: "ev-e2e-app",
        branch: "r1a1-pinned",
        message: "e2e 1a1 pinned abcdef0",
      })
    ).toEqual([
      "deploy",
      ".",
      "--server",
      "ev-e2e-app",
      "--branch",
      "r1a1-pinned",
      "--no-github",
      "--json",
      "--yes",
      "--commit-message",
      "e2e 1a1 pinned abcdef0",
    ]);
  });

  it("adds the MF3 fallback commands", () => {
    const argv = deployArgv({
      fixtureDir: ".",
      server: "s",
      branch: "b",
      message: "m",
      fallbackCommands: true,
      supportsCommitMessage: false,
    });
    expect(argv.slice(-4)).toEqual([
      "--build-command",
      "npm ci && npx mcp-use build",
      "--start-command",
      "npx mcp-use start",
    ]);
    expect(argv).not.toContain("--commit-message");
  });
});
