/**
 * Optional project-local Inspector loading for {@link runDev}.
 *
 * The production `mcp-use` package deliberately has no dependency edge to
 * `@mcp-use/inspector`. Development resolves the package from the user's
 * project so pnpm and other non-hoisting package managers use the version
 * pinned by that project's lockfile.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Web-standard handler returned by the Inspector's development mount. */
export type DevInspectorHandler = (request: Request) => Promise<Response>;

/** Options accepted by the project-local Inspector mount. */
export interface DevInspectorMountOptions {
  /** Server-wide MCP path prefix, such as `/mcp`. */
  basePath: string;
  /** Absolute MCP endpoint selected when the Inspector first opens. */
  autoConnectUrl: string;
  /** Allow the local Inspector proxy and OAuth BFF to reach loopback targets. */
  oauthProxyAllowLoopback: boolean;
  /** Mark the mounted UI as part of the `mcp-use dev` process. */
  devMode: true;
}

/** Structurally typed Inspector package entry loaded from the user's project. */
export interface ProjectInspectorModule {
  /** Create the self-contained Inspector Fetch handler. */
  mountInspector(options: DevInspectorMountOptions): DevInspectorHandler;
}

/** Result of resolving the optional project-local Inspector package. */
export type ProjectInspectorLoadResult =
  | { installed: true; module: ProjectInspectorModule }
  | { installed: false };

/**
 * Resolve and import `@mcp-use/inspector` from a project directory.
 *
 * A missing package is an expected optional-tooling state and returns
 * `{ installed: false }`. A present but incompatible or broken package throws
 * so version or installation problems are not misreported as absence.
 *
 * @param cwd - Project root whose dependency graph owns the Inspector version.
 * @returns The validated module, or an absent result when it is not installed.
 *
 * @internal
 */
export async function loadProjectInspector(
  cwd: string
): Promise<ProjectInspectorLoadResult> {
  const manifestPath = join(cwd, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;
  const dependencyFields = [
    manifest["dependencies"],
    manifest["devDependencies"],
    manifest["optionalDependencies"],
  ];
  const declared = dependencyFields.some(
    (field) =>
      field !== null &&
      typeof field === "object" &&
      "@mcp-use/inspector" in field
  );
  if (!declared) return { installed: false };

  const projectRequire = createRequire(manifestPath);
  let entry: string;
  try {
    entry = projectRequire.resolve("@mcp-use/inspector/dev");
  } catch (error) {
    if (errorCode(error) === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      try {
        // Older packages exposed mountInspector from their root only. Keeping
        // this fallback makes the development CLI tolerant of that export map
        // while new packages use the explicit development subpath.
        entry = projectRequire.resolve("@mcp-use/inspector");
      } catch (fallbackError) {
        if (isMissingInspector(fallbackError)) return { installed: false };
        throw fallbackError;
      }
    } else if (isMissingInspector(error)) {
      return { installed: false };
    } else {
      throw error;
    }
  }

  const loaded = (await import(
    pathToFileURL(entry).href
  )) as Partial<ProjectInspectorModule>;
  if (typeof loaded.mountInspector !== "function") {
    throw new Error(
      "The installed @mcp-use/inspector is incompatible: its package entry " +
        "does not export mountInspector(). Update the development dependency."
    );
  }
  return { installed: true, module: loaded as ProjectInspectorModule };
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function isMissingInspector(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/**
 * Return an install command tailored to the active package-manager process.
 *
 * @returns A command that adds the current beta Inspector as a dev dependency.
 *
 * @internal
 */
export function inspectorInstallCommand(): string {
  const userAgent = process.env["npm_config_user_agent"] ?? "";
  if (userAgent.startsWith("pnpm/")) {
    return "pnpm add -D @mcp-use/inspector@beta";
  }
  if (userAgent.startsWith("yarn/")) {
    return "yarn add -D @mcp-use/inspector@beta";
  }
  if (userAgent.startsWith("bun/")) {
    return "bun add -d @mcp-use/inspector@beta";
  }
  return "npm install --save-dev @mcp-use/inspector@beta";
}
