import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CommandError,
  GLOBAL_STATE_DIR,
  pathExists,
  UsageError,
  writePrivateJson,
} from "./shared.js";

/** Runtime surface loaded from the independently published client SDK. */
export type ClientPackage = typeof import("@mcp-use/client");

const CLIENT_SDK_DIR = join(GLOBAL_STATE_DIR, "client-sdk");
const CLIENT_PACKAGE = "@mcp-use/client";
const DEFAULT_PEER_RANGE = "^2.0.0-alpha.0";

const INSTALL_HINT = [
  `[mcp-use] ${CLIENT_PACKAGE} is not installed.`,
  "The `mcp-use client` and `mcp-use screenshot` commands require it.",
  "Install it in your project:",
  "",
  "  npm install @mcp-use/client",
  "",
  "  pnpm add @mcp-use/client",
  "",
  "  bun add @mcp-use/client",
].join("\n");

/**
 * Walk upward from `startDir` for the nearest directory containing
 * `package.json`.
 */
export async function findProjectRoot(
  startDir: string
): Promise<string | undefined> {
  let current = resolve(startDir);
  for (;;) {
    if (await pathExists(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Load `@mcp-use/client` on demand so the framework library entry does not
 * pull the client SDK (or legacy v1 transitive deps) into every install.
 *
 * @throws {@link UsageError} When the package is not installed and auto-install
 * fails or the retry import still cannot resolve it.
 */
export async function loadClientPackage(): Promise<ClientPackage> {
  try {
    return await importClientModule();
  } catch (error) {
    if (!isClientPackageMissing(error)) throw error;

    const location = await installClientPackage();
    try {
      return location === "sandbox"
        ? await importSandboxClientModule()
        : await importClientModule();
    } catch (retryError) {
      if (isClientPackageMissing(retryError)) {
        throw new UsageError(INSTALL_HINT);
      }
      throw retryError;
    }
  }
}

async function installClientPackage(): Promise<"project" | "sandbox"> {
  const versionSpec = readClientPeerRange();
  const dependency = `${CLIENT_PACKAGE}@${versionSpec}`;
  const projectRoot = await findProjectRoot(process.cwd());

  process.stderr.write(`[mcp-use] installing ${CLIENT_PACKAGE}…\n`);

  if (projectRoot !== undefined) {
    const [command, args] = packageManagerInstallArgs(dependency);
    const code = await spawnAndWait(command, args, projectRoot);
    if (code !== 0) {
      throw new CommandError(
        "client_install_failed",
        `Failed to install ${CLIENT_PACKAGE}.`
      );
    }
    return "project";
  }

  await mkdir(CLIENT_SDK_DIR, { recursive: true, mode: 0o700 });
  await chmod(CLIENT_SDK_DIR, 0o700);
  const manifestPath = join(CLIENT_SDK_DIR, "package.json");
  if (!(await pathExists(manifestPath))) {
    await writePrivateJson(manifestPath, {
      private: true,
      dependencies: {
        [CLIENT_PACKAGE]: versionSpec,
      },
    });
  }
  const code = await spawnAndWait(
    "npm",
    ["install", dependency],
    CLIENT_SDK_DIR
  );
  if (code !== 0) {
    throw new CommandError(
      "client_install_failed",
      `Failed to install ${CLIENT_PACKAGE}.`
    );
  }
  return "sandbox";
}

function packageManagerInstallArgs(dependency: string): [string, string[]] {
  const userAgent = process.env["npm_config_user_agent"] ?? "";
  if (userAgent.startsWith("pnpm/")) {
    return ["pnpm", ["add", dependency]];
  }
  if (userAgent.startsWith("bun/")) {
    return ["bun", ["add", dependency]];
  }
  return ["npm", ["install", dependency]];
}

function readClientPeerRange(): string {
  for (const relative of ["../package.json", "../../package.json"]) {
    try {
      const raw = readFileSync(new URL(relative, import.meta.url), "utf8");
      const pkg = JSON.parse(raw) as {
        name?: unknown;
        peerDependencies?: Record<string, string>;
      };
      if (pkg.name !== "mcp-use") continue;
      const range = pkg.peerDependencies?.[CLIENT_PACKAGE];
      if (typeof range === "string" && range.length > 0) return range;
    } catch {
      // Try the next candidate layout.
    }
  }
  return DEFAULT_PEER_RANGE;
}

async function importClientModule(): Promise<ClientPackage> {
  return import("@mcp-use/client");
}

async function importSandboxClientModule(): Promise<ClientPackage> {
  const entry = join(
    CLIENT_SDK_DIR,
    "node_modules",
    CLIENT_PACKAGE,
    "dist",
    "index.js"
  );
  const mod = (await import(pathToFileURL(entry).href)) as ClientPackage;
  return mod;
}

function isClientPackageMissing(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
    return (
      error.message.includes(CLIENT_PACKAGE) ||
      error.message.includes("Cannot find package")
    );
  }
  return false;
}

function spawnAndWait(
  command: string,
  args: string[],
  cwd: string
): Promise<number> {
  return new Promise((resolveCode, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveCode(signal === "SIGINT" ? 130 : (code ?? 1));
    });
  });
}
