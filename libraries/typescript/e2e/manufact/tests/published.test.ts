// Package sources `canary` and `pr` and the PR dev-space branch (PLAN.md §18.8.1).
import { describe, expect, it } from "vitest";
// @ts-ignore -- plain ESM script module
import {
  branchName,
  checkLockfile,
  commitMessage,
  compareIdentity,
  fixtureManifest,
  isJanitorBranch,
  janitorSelect,
  previewUrl,
  resolveCanary,
  sdkFromDependencies,
} from "../scripts/lib.mjs";
import { PACKUMENTS, SDK_PINS } from "./packuments.js";

describe("PR dev-space branch", () => {
  it("is pr<number>-<variant>, stable across runs and attempts", () => {
    expect(branchName({ pr: 3210, variant: "pr" })).toBe("pr3210-pr");
    expect(
      branchName({ pr: "3210", runId: "99", attempt: "4", variant: "pr" })
    ).toBe("pr3210-pr");
  });

  it("rejects a PR that is not a number", () => {
    expect(() => branchName({ pr: "feat-x", variant: "pr" })).toThrow();
  });

  it("is a janitor branch, aged out by its own longer limit", () => {
    expect(isJanitorBranch("pr3210-pr")).toBe(true);
    const now = Date.parse("2026-11-25T12:00:00Z");
    const deployments = [
      {
        id: "pr-two-days",
        serverId: "srv",
        branch: "pr3210-pr",
        createdAt: "2026-11-23T12:00:00Z",
      },
      {
        id: "pr-ten-days",
        serverId: "srv",
        branch: "pr3100-pr",
        createdAt: "2026-11-15T12:00:00Z",
      },
      {
        id: "run-two-days",
        serverId: "srv",
        branch: "r1a1-canary",
        createdAt: "2026-11-23T12:00:00Z",
      },
    ];
    expect(
      janitorSelect(deployments, {
        serverId: "srv",
        now,
        maxAgeMs: 6 * 3600_000,
        prMaxAgeMs: 7 * 86400_000,
      }).map((d: { id: string }) => d.id)
    ).toEqual(["pr-ten-days", "run-two-days"]);
  });

  it("commit message ends with the mcp-use version when the bundle has no sha", () => {
    expect(
      commitMessage({
        runId: 5,
        attempt: 1,
        variant: "canary",
        version: "2.12.10-canary.2",
      })
    ).toBe("e2e 5a1 canary 2.12.10-canary.2");
  });
});

describe("previewUrl", () => {
  it("is the per-commit pkg.pr.new URL, scoped names included", () => {
    expect(previewUrl("mcp-use", "abcdef0123456789")).toBe(
      "https://pkg.pr.new/mcp-use/mcp-use/mcp-use@abcdef0"
    );
    expect(previewUrl("@mcp-use/cli", "abcdef0", "http://127.0.0.1:9")).toBe(
      "http://127.0.0.1:9/mcp-use/mcp-use/@mcp-use/cli@abcdef0"
    );
  });

  it("refuses a PR number, which moves with the PR", () => {
    expect(() => previewUrl("mcp-use", "3210")).toThrow();
  });
});

describe("resolveCanary", () => {
  it("anchors on mcp-use@canary, takes its exact @mcp-use pins and skips unpublished packages", () => {
    expect(resolveCanary(PACKUMENTS)).toEqual({
      versions: {
        "mcp-use": "2.12.10-canary.2",
        "@mcp-use/client": "2.4.7-canary.0",
        "@mcp-use/cli": "5.4.1-canary.1",
        "@mcp-use/inspector": "20.3.34-canary.0",
      },
      integrity: {
        "mcp-use": "sha512-mcpuse",
        "@mcp-use/client": "sha512-client",
        "@mcp-use/cli": "sha512-cli1",
        "@mcp-use/inspector": "sha512-inspector",
      },
      sdk: { client: "2.3.1", core: "2.3.1", server: "2.3.1" },
      skipped: ["@mcp-use/events-core", "@mcp-use/agent"],
    });
  });

  it("fails with class infra when mcp-use has no such dist-tag", () => {
    expect(() => resolveCanary(PACKUMENTS, { tag: "events" })).toThrow(
      expect.objectContaining({ failureClass: "infra" })
    );
  });

  it("fails with class product when the published SDK pin is a range", () => {
    expect(() =>
      sdkFromDependencies({
        ...SDK_PINS,
        "@modelcontextprotocol/core": "^2.3.1",
      })
    ).toThrow(expect.objectContaining({ failureClass: "product" }));
  });
});

describe("fixture manifest and R3a for published sources", () => {
  const specs = {
    "mcp-use": "2.12.10-canary.2",
    "@mcp-use/client": "2.4.7-canary.0",
    "@mcp-use/cli": "5.4.1-canary.1",
  };
  const sdk = { client: "2.3.1", core: "2.3.1", server: "2.3.1" };

  it("pins each published package to its exact spec and lists nothing else", () => {
    expect(fixtureManifest({ sdk, mcpUse: specs })).toEqual({
      name: "ev-e2e-fixture",
      private: true,
      type: "module",
      engines: { node: ">=22.22.2" },
      scripts: { build: "mcp-use build", start: "mcp-use start" },
      dependencies: {
        "mcp-use": "2.12.10-canary.2",
        "@mcp-use/client": "2.4.7-canary.0",
        zod: "^4.6.6",
      },
      overrides: {
        "mcp-use": "$mcp-use",
        "@mcp-use/client": "$@mcp-use/client",
        "@mcp-use/cli": "5.4.1-canary.1",
        "@modelcontextprotocol/client": "2.3.1",
        "@modelcontextprotocol/core": "2.3.1",
        "@modelcontextprotocol/server": "2.3.1",
      },
    });
  });

  const registry = (name: string, v: string) =>
    `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${v}.tgz`;
  const lock = {
    packages: {
      "": {},
      "node_modules/mcp-use": {
        version: "2.12.10-canary.2",
        resolved: registry("mcp-use", "2.12.10-canary.2"),
      },
      "node_modules/@mcp-use/client": {
        version: "2.4.7-canary.0",
        resolved: registry("@mcp-use/client", "2.4.7-canary.0"),
      },
      "node_modules/@mcp-use/cli": {
        version: "5.4.1-canary.1",
        resolved: registry("@mcp-use/cli", "5.4.1-canary.1"),
      },
      "node_modules/@modelcontextprotocol/server": { version: "2.3.1" },
    },
  };

  it("passes when the lockfile has the exact canary versions from the registry", () => {
    expect(checkLockfile(lock, { sdk, mcpUse: specs })).toEqual([]);
  });

  it("fails a package at another version and one that is not in the bundle", () => {
    const bad = structuredClone(lock) as any;
    bad.packages["node_modules/@mcp-use/cli"].version = "5.4.1-canary.3";
    bad.packages["node_modules/@mcp-use/inspector"] = { version: "20.3.33" };
    expect(checkLockfile(bad, { sdk, mcpUse: specs })).toEqual([
      {
        code: "MCP_USE_SPEC_MISMATCH",
        name: "@mcp-use/cli",
        path: "node_modules/@mcp-use/cli",
        want: "5.4.1-canary.1",
        got: "5.4.1-canary.3",
      },
      {
        code: "MCP_USE_SPEC_MISMATCH",
        name: "@mcp-use/inspector",
        path: "node_modules/@mcp-use/inspector",
        want: null,
        got: "20.3.33",
      },
    ]);
  });

  it("compares preview packages by resolved URL", () => {
    const url = "https://pkg.pr.new/mcp-use/mcp-use/mcp-use@abcdef0";
    const prLock = {
      packages: {
        "node_modules/mcp-use": { version: "2.12.10", resolved: url },
        "node_modules/@mcp-use/client": {
          version: "2.4.6",
          resolved:
            "https://registry.npmjs.org/@mcp-use/client/-/client-2.4.6.tgz",
        },
      },
    };
    expect(
      checkLockfile(prLock, {
        sdk,
        mcpUse: {
          "mcp-use": url,
          "@mcp-use/client":
            "https://pkg.pr.new/mcp-use/mcp-use/@mcp-use/client@abcdef0",
        },
      })
    ).toEqual([
      {
        code: "MCP_USE_SPEC_MISMATCH",
        name: "@mcp-use/client",
        path: "node_modules/@mcp-use/client",
        want: "https://pkg.pr.new/mcp-use/mcp-use/@mcp-use/client@abcdef0",
        got: "https://registry.npmjs.org/@mcp-use/client/-/client-2.4.6.tgz",
      },
    ]);
  });

  it("E0 does not compare the patch predicate for a bundle that cannot know it", () => {
    expect(
      compareIdentity(
        { sdk: { server: "2.3.1" } },
        { sdk: { bundled: "2.3.1", external: "2.3.1", patchedPredicate: true } }
      )
    ).toEqual([]);
  });
});
