/**
 * Loads the Events surface of the `@mcp-use/client` copy the CLI uses, plus
 * `@mcp-use/client/webhooks` and `@mcp-use/events-core/conformance` from that
 * same install, so every `events` command runs on one build (PLAN.md §11.3).
 *
 * @internal
 */

import { readFileSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CommandError } from "../../core/errors.js";
import { GLOBAL_STATE_DIR, pathExists } from "../../core/fs.js";
import type {
  ClientEventsModule,
  ClientWebhooksModule,
  ConformanceModule,
} from "./types.js";

const CLIENT_PACKAGE = "@mcp-use/client";
const EVENTS_CORE_PACKAGE = "@mcp-use/events-core";

function eventsUnsupported(what: string): CommandError {
  return new CommandError(
    "events_client_unsupported",
    `The installed ${CLIENT_PACKAGE} has no MCP Events support (${what} is missing). Update ${CLIENT_PACKAGE} to a release with Events.`,
    {
      nextSteps: [
        {
          description: "Update the client SDK in this project",
          command: `npm install ${CLIENT_PACKAGE}@latest`,
        },
      ],
    }
  );
}

/**
 * Narrow the loaded `@mcp-use/client` module to its Events exports.
 *
 * @param pkg - The module returned by `loadClientPackage`.
 * @returns The Events exports.
 * @throws {@link CommandError} `events_client_unsupported` when the copy predates Events.
 */
export function clientEvents(pkg: unknown): ClientEventsModule {
  const mod = pkg as Partial<Record<keyof ClientEventsModule, unknown>>;
  for (const key of [
    "createSdkClientEventsAdapter",
    "createEventsConnection",
    "createEventsManager",
    "EventsLaneError",
  ] as const) {
    if (typeof mod[key] !== "function") throw eventsUnsupported(key);
  }
  return pkg as ClientEventsModule;
}

async function findProjectRoot(startDir: string): Promise<string | undefined> {
  let current = resolve(startDir);
  for (;;) {
    if (await pathExists(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * The directory of the `@mcp-use/client` copy in use, resolved in the same
 * order as `loadClientPackage`: next to the CLI, then the project, then the
 * CLI's private install.
 */
async function clientPackageDir(): Promise<string> {
  const projectRoot = await findProjectRoot(process.cwd());
  const bases: string[] = [import.meta.url];
  if (projectRoot !== undefined) {
    bases.push(pathToFileURL(join(projectRoot, "package.json")).href);
  }
  bases.push(
    pathToFileURL(join(GLOBAL_STATE_DIR, "client-sdk", "package.json")).href
  );
  for (const base of bases) {
    try {
      const manifest = findPackageJSON(CLIENT_PACKAGE, base);
      if (manifest !== undefined) return dirname(manifest);
    } catch {
      // Not installed relative to this base; try the next one.
    }
  }
  throw new CommandError(
    "client_install_required",
    `${CLIENT_PACKAGE} is required for this command. Install it in this project with its package manager.`
  );
}

function exportEntry(packageDir: string, subpath: string): string | undefined {
  const pkg = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8")
  ) as { exports?: Record<string, unknown> };
  const entry = pkg.exports?.[subpath];
  if (typeof entry === "string") return join(packageDir, entry);
  if (entry !== null && typeof entry === "object") {
    const target = entry as Record<string, unknown>;
    const node = target.node as Record<string, unknown> | undefined;
    const file = node?.import ?? target.import ?? target.default;
    if (typeof file === "string") return join(packageDir, file);
  }
  return undefined;
}

/**
 * Load `@mcp-use/client/webhooks` from the client copy in use.
 *
 * @returns `listenForEvents`.
 * @throws {@link CommandError} `events_client_unsupported` when the entry is missing.
 */
export async function loadClientWebhooks(): Promise<ClientWebhooksModule> {
  const dir = await clientPackageDir();
  const entry = exportEntry(dir, "./webhooks");
  if (entry === undefined)
    throw eventsUnsupported(`${CLIENT_PACKAGE}/webhooks`);
  const mod = (await import(
    pathToFileURL(entry).href
  )) as Partial<ClientWebhooksModule>;
  if (typeof mod.listenForEvents !== "function") {
    throw eventsUnsupported("listenForEvents");
  }
  return mod as ClientWebhooksModule;
}

/**
 * Load `@mcp-use/events-core/conformance` from the client copy's own
 * dependency, so `check` runs the catalog that client was built with.
 *
 * @returns The conformance runner and JUnit renderer.
 * @throws {@link CommandError} `events_client_unsupported` when it is missing.
 */
export async function loadConformance(): Promise<ConformanceModule> {
  const clientDir = await clientPackageDir();
  let coreDir: string;
  try {
    const manifest = findPackageJSON(
      EVENTS_CORE_PACKAGE,
      pathToFileURL(join(clientDir, "package.json")).href
    );
    if (manifest === undefined) throw new Error("not found");
    coreDir = dirname(manifest);
  } catch {
    throw eventsUnsupported(EVENTS_CORE_PACKAGE);
  }
  const entry = exportEntry(coreDir, "./conformance");
  if (entry === undefined) {
    throw eventsUnsupported(`${EVENTS_CORE_PACKAGE}/conformance`);
  }
  const mod = (await import(
    pathToFileURL(entry).href
  )) as Partial<ConformanceModule>;
  if (
    typeof mod.runConformance !== "function" ||
    typeof mod.toJUnit !== "function"
  ) {
    throw eventsUnsupported("runConformance");
  }
  return mod as ConformanceModule;
}
