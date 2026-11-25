// S0 (PLAN.md §18): every package resolves the same official SDK version that
// the `mcp-sdk` catalog pins, and the built bundles report that same version
// as the SDK they compile in. A bump that moves one package but not another,
// or a stale build, fails here before any Events behaviour is tested.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));
const WORKSPACE = fileURLToPath(new URL("../../../../", import.meta.url));
const SDK = [
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/core",
  "@modelcontextprotocol/server",
] as const;

/** Read `catalogs.mcp-sdk` from pnpm-workspace.yaml. */
async function catalogPins(): Promise<Record<string, string>> {
  const yaml = await readFile(join(WORKSPACE, "pnpm-workspace.yaml"), "utf8");
  const block = /^catalogs:\n {2}mcp-sdk:\n((?: {4}.+\n)+)/m.exec(yaml);
  if (!block?.[1])
    throw new Error("pnpm-workspace.yaml has no catalogs.mcp-sdk");
  const pins: Record<string, string> = {};
  for (const line of block[1].trimEnd().split("\n")) {
    const match = /^ {4}"?([^":]+)"?:\s*(\S+)$/.exec(line);
    if (match?.[1] && match[2]) pins[match[1]] = match[2];
  }
  return pins;
}

/** The installed version of `name` as seen from package directory `pkg`. */
async function installedVersion(pkg: string, name: string): Promise<string> {
  const require = createRequire(join(PACKAGES, pkg, "package.json"));
  let dir = dirname(require.resolve(name));
  for (;;) {
    try {
      const manifest = JSON.parse(
        await readFile(join(dir, "package.json"), "utf8")
      ) as { name?: string; version: string };
      if (manifest.name === name) return manifest.version;
    } catch {
      // not the package root yet
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${name} not found from ${pkg}`);
    dir = parent;
  }
}

describe("S0 sdk-lockstep", () => {
  it("pins client, core and server to one exact version", async () => {
    const pins = await catalogPins();
    expect(Object.keys(pins).sort()).toEqual([...SDK]);
    expect(new Set(Object.values(pins)).size).toBe(1);
    expect(Object.values(pins)[0]).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
  });

  it.each([
    ["server", SDK],
    ["client", ["@modelcontextprotocol/client", "@modelcontextprotocol/core"]],
    ["cli", ["@modelcontextprotocol/client", "@modelcontextprotocol/server"]],
    ["agent", ["@modelcontextprotocol/client"]],
  ] as const)(
    "resolves the pinned SDK from packages/%s",
    async (pkg, names) => {
      const pins = await catalogPins();
      for (const name of names) {
        expect(await installedVersion(pkg, name), `${pkg} → ${name}`).toBe(
          pins[name]
        );
      }
    }
  );

  it.each(["server", "cli"])(
    "packages/%s/dist reports the pinned SDK as compiled in",
    async (pkg) => {
      const pins = await catalogPins();
      const info = JSON.parse(
        await readFile(join(PACKAGES, pkg, "dist", "sdk-info.json"), "utf8")
      ) as { sdk: { bundled: string; bundledHash: string } };
      expect(info.sdk.bundled).toBe(pins["@modelcontextprotocol/server"]);
      expect(info.sdk.bundledHash).toMatch(/^sha256-[0-9a-f]{32}$/);
    }
  );
});
