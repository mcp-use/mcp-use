import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { UsageError } from "../../core/errors.js";
import { pathExists } from "../../core/fs.js";
import type { Cloud } from "./types.js";
/** Resolve a relative path while keeping it inside the project root. */
export function resolveContainedPath(
  root: string,
  value: string,
  option: string
): string {
  if (isAbsolute(value)) throw new UsageError(`${option} must be relative.`);
  const target = resolve(root, value);
  const path = relative(root, target);
  if (path.startsWith("..") || isAbsolute(path)) {
    throw new UsageError(`${option} must not escape the project directory.`);
  }
  return target;
}

/** Validate an optional project-relative source setting. */
export function validateSourcePath(
  sourceRoot: string,
  value: string | undefined,
  option: string
): void {
  if (value === undefined) return;
  resolveContainedPath(sourceRoot, value, option);
}

/** Validate the same source settings for dry runs and real local uploads. */
export async function validateUploadSource(
  cwd: string,
  rootDir: string | undefined,
  dockerfile: string | undefined
): Promise<string> {
  const sourceRoot = resolveContainedPath(cwd, rootDir ?? ".", "--root-dir");
  if (!(await pathExists(sourceRoot)))
    throw new UsageError(`Project directory not found: ${sourceRoot}`);
  validateSourcePath(sourceRoot, dockerfile, "--dockerfile");
  return sourceRoot;
}

/** Read environment-file assignments followed by explicit overrides. */
export async function loadEnvironment(
  cwd: string,
  envFile: string | undefined,
  assignments: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (envFile !== undefined) {
    const path = resolveContainedPath(cwd, envFile, "--env-file");
    if (!(await pathExists(path))) {
      throw new UsageError(`Environment file not found: ${envFile}`);
    }
    for (const raw of (await readFile(path, "utf8")).split(/\r?\n/)) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      assignEnvironment(result, line);
    }
  }
  for (const assignment of assignments) assignEnvironment(result, assignment);
  return result;
}

function assignEnvironment(
  target: Record<string, string>,
  assignment: string
): void {
  const separator = assignment.indexOf("=");
  const key = assignment.slice(0, separator);
  if (separator <= 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new UsageError("Invalid environment assignment; expected KEY=VALUE.");
  }
  target[key] = assignment.slice(separator + 1);
}

/** Write env values to the environment used by this exact deployment. */
export async function syncEnvironment(
  cloud: Cloud,
  serverId: string,
  values: Record<string, string>,
  deployedBranch: string,
  productionBranch: string
): Promise<void> {
  if (Object.keys(values).length === 0) return;
  const production = deployedBranch === productionBranch;
  const branch = production ? null : deployedBranch;
  const environments: ("production" | "preview")[] = production
    ? ["production"]
    : ["preview"];
  const variables = await cloud.call(
    cloud.client.GET("/api/v1/servers/{id}/env-variables", {
      params: {
        path: { id: serverId },
        query: { ...(branch === null ? {} : { branch }) },
      },
    })
  );
  for (const [key, value] of Object.entries(values)) {
    const variable = variables.find(
      (item) =>
        item.key === key &&
        item.branch === branch &&
        item.environments.includes(environments[0]!)
    );
    if (variable === undefined) {
      await cloud.call(
        cloud.client.POST("/api/v1/servers/{id}/env-variables", {
          params: { path: { id: serverId } },
          body: { key, value, branch, environments },
        })
      );
    } else {
      // Omit sensitive so rotating a value preserves the server's setting.
      await cloud.call(
        cloud.client.PATCH("/api/v1/servers/{id}/env-variables/{varId}", {
          params: { path: { id: serverId, varId: variable.id } },
          body: { value, branch, environments },
        })
      );
    }
  }
}
