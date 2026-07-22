/**
 * Inspector loading for {@link runDev}.
 *
 * A project's direct Inspector remains an override. Otherwise the CLI loads
 * its peer supplied by `mcp-use`, including with strict pnpm layouts.
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
  if (declared) {
    const projectRequire = createRequire(manifestPath);
    try {
      const entry = projectRequire.resolve("@mcp-use/inspector");
      return validateInspector(
        (await import(
          pathToFileURL(entry).href
        )) as Partial<ProjectInspectorModule>
      );
    } catch (error) {
      if (!isMissingInspector(error)) throw error;
    }
  }

  try {
    return validateInspector(
      (await import("@mcp-use/inspector")) as Partial<ProjectInspectorModule>
    );
  } catch (error) {
    if (isMissingInspector(error)) return { installed: false };
    throw error;
  }
}

function validateInspector(
  loaded: Partial<ProjectInspectorModule>
): ProjectInspectorLoadResult {
  if (typeof loaded.mountInspector !== "function") {
    throw new Error(
      "The installed @mcp-use/inspector is incompatible: its package entry " +
        "does not export mountInspector(). Update the development dependency."
    );
  }
  return { installed: true, module: loaded as ProjectInspectorModule };
}

function isMissingInspector(error: unknown): boolean {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? String(error.code)
      : undefined;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}
