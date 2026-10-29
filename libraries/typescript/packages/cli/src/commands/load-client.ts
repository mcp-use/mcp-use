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
type ClientPackage = typeof import("@mcp-use/client");

const CLIENT_SDK_DIR = join(GLOBAL_STATE_DIR, "client-sdk");
const CLIENT_PACKAGE = "@mcp-use/client";
/** Used only if the CLI's own package.json can't be read. */
const DEFAULT_PEER_RANGE = "^2.0.1";

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
async function findProjectRoot(startDir: string): Promise<string | undefined> {
  let current = resolve(startDir);
  for (;;) {
    if (await pathExists(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Where `@mcp-use/client` was auto-installed. */
interface InstallLocation {
  location: "project" | "sandbox";
  projectRoot?: string;
}

interface LoadClientPackageOptions {
  /** Allow installing the optional SDK when it is not already available. */
  allowInstall?: boolean;
}

/**
 * Load `@mcp-use/client` on demand so the framework library entry does not
 * pull the client SDK (or legacy v1 transitive deps) into every install.
 *
 * @throws {@link UsageError} When the package is not installed and auto-install
 * fails or the retry import still cannot resolve it.
 */
export async function loadClientPackage(
  options: LoadClientPackageOptions = {}
): Promise<ClientPackage> {
  try {
    return await importClientModule();
  } catch (error) {
    if (!isClientPackageMissing(error)) throw error;
    if (options.allowInstall === false) {
      throw new CommandError(
        "client_install_required",
        `${CLIENT_PACKAGE} is required for this command.`,
        {
          nextSteps: [
            {
              description: "Install the optional client SDK",
              command: `npm install ${CLIENT_PACKAGE}`,
            },
          ],
        }
      );
    }

    const installed = await installClientPackage();
    try {
      return installed.location === "sandbox"
        ? await importSandboxClientModule()
        : await importProjectClientModule(installed.projectRoot!);
    } catch (retryError) {
      if (isClientPackageMissing(retryError)) {
        throw new UsageError(INSTALL_HINT);
      }
      throw retryError;
    }
  }
}

async function installClientPackage(): Promise<InstallLocation> {
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
    return { location: "project", projectRoot };
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
  return { location: "sandbox" };
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

/**
 * @internal Read the `@mcp-use/client` peer range from this package's own
 * manifest: `../package.json` from the built `dist/` chunk, or
 * `../../package.json` from `src/commands/`.
 */
export function readClientPeerRange(): string {
  for (const relative of ["../package.json", "../../package.json"]) {
    try {
      const raw = readFileSync(new URL(relative, import.meta.url), "utf8");
      const pkg = JSON.parse(raw) as {
        name?: unknown;
        peerDependencies?: Record<string, string>;
      };
      if (pkg.name !== "@mcp-use/cli") continue;
      const range = pkg.peerDependencies?.[CLIENT_PACKAGE];
      if (typeof range === "string" && range.length > 0) return range;
    } catch {
      // Try the next candidate layout.
    }
  }
  return DEFAULT_PEER_RANGE;
}

async function importClientModule(): Promise<ClientPackage> {
  disableBrokenNodeLocalStorage();
  return import("@mcp-use/client");
}

/**
 * @internal Imported from project `node_modules` after auto-install.
 *
 * Imports the installed entry file directly instead of resolving the package
 * name. The failed `import("@mcp-use/client")` that triggered the install
 * leaves Node 24 with a cached "no package.json" for the package directory,
 * so resolving the name again in this process lands on a nonexistent
 * `index.js`. `import.meta.resolve` also ignores its parent argument unless
 * Node runs with `--experimental-import-meta-resolve`.
 */
export async function importProjectClientModule(
  projectRoot: string
): Promise<ClientPackage> {
  return importInstalledClientModule(projectRoot);
}

async function importSandboxClientModule(): Promise<ClientPackage> {
  return importInstalledClientModule(CLIENT_SDK_DIR);
}

/**
 * Import the nearest installed copy at or above `installRoot`. Package managers
 * with workspaces can hoist the dependency to an ancestor `node_modules`, so
 * walk up the way Node's resolver would, using plain file checks.
 */
async function importInstalledClientModule(
  installRoot: string
): Promise<ClientPackage> {
  disableBrokenNodeLocalStorage();
  let current = resolve(installRoot);
  for (;;) {
    const packageDir = join(current, "node_modules", CLIENT_PACKAGE);
    if (await pathExists(join(packageDir, "package.json"))) {
      const entry = join(packageDir, "dist", "index.js");
      return import(pathToFileURL(entry).href) as Promise<ClientPackage>;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const error = new Error(
    `Cannot find package '${CLIENT_PACKAGE}' from ${installRoot}`
  ) as NodeJS.ErrnoException;
  error.code = "ERR_MODULE_NOT_FOUND";
  throw error;
}

/**
 * Node 25 exposes a lazy `localStorage` getter that warns unless the process
 * was started with `--localstorage-file`. The CLI client uses its own encrypted
 * filesystem stores, so the browser global is neither needed nor desirable.
 * Shadow the getter without reading it, which also keeps JSON stderr clean.
 */
function disableBrokenNodeLocalStorage(): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage"
  );
  if (descriptor?.get === undefined || descriptor.configurable !== true) return;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    enumerable: descriptor.enumerable ?? false,
    value: undefined,
    writable: true,
  });
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

/**
 * Quote one argument for `cmd.exe`. Inside double quotes `cmd.exe` keeps `^`,
 * `|`, `&`, `<` and `>` literally, so a semver range such as `^2.0.0` or
 * `^2.0.1 || ^2.1.0` reaches the package manager unchanged. Arguments are
 * package names, version ranges and fixed subcommands, which never contain
 * `"` or `%`.
 */
function quoteWindowsShellArg(arg: string): string {
  return `"${arg}"`;
}

/** @internal Exported for tests that run a fake package manager. */
export function spawnAndWait(
  command: string,
  args: string[],
  cwd: string
): Promise<number> {
  return new Promise((resolveCode, reject) => {
    // npm and pnpm are .cmd shims on Windows, which Node only runs through a
    // shell. Pass them as one command string: Node warns (DEP0190) when an
    // args array is combined with `shell: true`. Quote each argument, or
    // `cmd.exe` strips the `^` from version ranges and treats `||` as an
    // operator.
    const isWindows = process.platform === "win32";
    const child = spawn(
      isWindows
        ? [command, ...args.map(quoteWindowsShellArg)].join(" ")
        : command,
      isWindows ? [] : args,
      {
        cwd,
        stdio: "inherit",
        shell: isWindows,
      }
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveCode(signal === "SIGINT" ? 130 : (code ?? 1));
    });
  });
}
