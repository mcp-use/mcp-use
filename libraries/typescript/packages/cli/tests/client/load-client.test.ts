import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectProjectPackageManager,
  importProjectClientModule,
  loadClientPackage,
  packageManagerInstallArgs,
  projectHasClient,
  readClientPeerRange,
} from "../../src/client/load-client.js";

const SERVER_PACKAGE_ROOT = join(
  fileURLToPath(new URL("../..", import.meta.url))
);

const CLIENTS_SDK = "@mcp-use/client@^2.0.1";

describe("loadClientPackage", () => {
  it("loads @mcp-use/client when installed", async () => {
    const mod = await loadClientPackage();
    expect(mod.MCPClient).toBeTypeOf("function");
    expect(mod.createOAuthProvider).toBeTypeOf("function");
  });

  it("imports @mcp-use/client from a project root after auto-install", async () => {
    const mod = await importProjectClientModule(SERVER_PACKAGE_ROOT);
    expect(mod.MCPClient).toBeTypeOf("function");
    expect(mod.createOAuthProvider).toBeTypeOf("function");
  });

  it("installs the @mcp-use/client range declared in the CLI's package.json", () => {
    const cliPackage = JSON.parse(
      readFileSync(join(SERVER_PACKAGE_ROOT, "package.json"), "utf8")
    ) as { peerDependencies: Record<string, string> };

    expect(readClientPeerRange()).toBe(
      cliPackage.peerDependencies["@mcp-use/client"]
    );
  });
});

async function mkdtempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mcp-use-load-client-"));
}

async function writePackageJson(root: string): Promise<void> {
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "repro", version: "1.0.0", private: true }),
    "utf8"
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("package manager selection for the client auto-install (#3081)", () => {
  it("uses the project's pnpm lockfile even when npx reports npm", async () => {
    const root = await mkdtempRoot();
    await writePackageJson(root);
    await writeFile(join(root, "pnpm-lock.yaml"), "", "utf8");
    // npx always sets an npm user agent, whatever the project uses.
    vi.stubEnv("npm_config_user_agent", "npm/11.20.0 node/v26.13.0 win32 x64");

    expect(await packageManagerInstallArgs(CLIENTS_SDK, root)).toEqual([
      "pnpm",
      ["add", CLIENTS_SDK],
    ]);
  });

  it.each([
    ["yarn.lock", "yarn", "add"],
    ["bun.lockb", "bun", "add"],
    ["bun.lock", "bun", "add"],
    ["package-lock.json", "npm", "install"],
  ] as const)("maps %s to %s", async (lockfile, command, subcommand) => {
    const root = await mkdtempRoot();
    await writePackageJson(root);
    await writeFile(join(root, lockfile), "", "utf8");

    expect(await packageManagerInstallArgs(CLIENTS_SDK, root)).toEqual([
      command,
      [subcommand, CLIENTS_SDK],
    ]);
  });

  it("falls back to the user agent only when the project has no lockfile", async () => {
    const root = await mkdtempRoot();
    await writePackageJson(root);
    vi.stubEnv(
      "npm_config_user_agent",
      "pnpm/12.18.0 npm/? node/v26.13.0 win32 x64"
    );

    expect(await detectProjectPackageManager(root)).toBeUndefined();
    expect(await packageManagerInstallArgs(CLIENTS_SDK, root)).toEqual([
      "pnpm",
      ["add", CLIENTS_SDK],
    ]);
    vi.stubEnv("npm_config_user_agent", "");
    expect(await packageManagerInstallArgs(CLIENTS_SDK, root)).toEqual([
      "npm",
      ["install", CLIENTS_SDK],
    ]);
  });
});

describe("projectHasClient", () => {
  it("is false when the project does not have the client installed", async () => {
    const root = await mkdtempRoot();
    await writePackageJson(root);

    expect(await projectHasClient(root)).toBe(false);
  });

  it("is true when the project's node_modules can resolve the client", async () => {
    const root = await mkdtempRoot();
    await writePackageJson(root);
    const client = join(root, "node_modules", "@mcp-use", "client");
    await mkdir(client, { recursive: true });
    await writeFile(
      join(client, "package.json"),
      JSON.stringify({
        name: "@mcp-use/client",
        version: "2.4.5",
        type: "module",
        exports: "./index.js",
      }),
      "utf8"
    );
    await writeFile(join(client, "index.js"), "export default {};\n", "utf8");

    expect(await projectHasClient(root)).toBe(true);
  });
});
