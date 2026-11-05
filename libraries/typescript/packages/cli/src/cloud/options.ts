import { parseArgs, type ParseArgsConfig } from "node:util";

import { connectCloud } from "./api/client.js";
import { connectProject } from "./project/resolve.js";
import { projectRoot, readProjectLink } from "./project/link-file.js";
import { UsageError } from "../core/errors.js";

const CLOUD_OPTIONS = {
  json: { type: "boolean" },
  org: { type: "string" },
  server: { type: "string" },
  path: { type: "string" },
} as const;

type Options = NonNullable<ParseArgsConfig["options"]>;

/** Strict argument parsing with positional ranges for optional or repeated inputs. */
export function parseCloudArgs<const O extends Options>(
  argv: readonly string[],
  options: O,
  usage: string,
  minimum = 0,
  maximum = minimum
) {
  try {
    const result = parseArgs({
      args: [...argv],
      options: { ...CLOUD_OPTIONS, ...options },
      strict: true,
      allowPositionals: true,
    });
    if (
      result.positionals.length < minimum ||
      result.positionals.length > maximum
    )
      throw new UsageError(`Usage: ${usage}`);
    return result;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(
      `${error instanceof Error ? error.message : String(error)}\nUsage: ${usage}`
    );
  }
}

/** Validate numeric flags before any Cloud request. */
export function integer(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < minimum ||
    number > maximum
  )
    throw new UsageError(
      `${name} must be an integer between ${minimum} and ${maximum}.`
    );
  return number;
}

type ScopeFlags = {
  org?: string | undefined;
  path?: string | undefined;
  server?: string | undefined;
};

/** Resolve organization flags, environment and project link without requiring a server. */
export async function cloudFor(flags: ScopeFlags) {
  const link = await readProjectLink(projectRoot(flags.path));
  return connectCloud({
    organization: flags.org ?? process.env["MANUFACT_ORG"] ?? link?.orgId,
  });
}

/** Resolve a server id or slug once, for operations whose path requires its id. */
export async function projectServer(flags: ScopeFlags, positional?: string) {
  const project = await connectProject({
    ...flags,
    server: positional ?? flags.server,
  });
  const found = await project.cloud.call(
    project.cloud.client.GET("/api/v1/servers/{id}", {
      params: { path: { id: project.server } },
    }),
    { notFound: { code: "server_not_found" } }
  );
  const details = {
    id: found.id,
    slug: found.slug,
    name: found.name,
    organizationId: found.organizationId,
    description: found.description,
    status: found.status,
    mcpUrl: found.mcpUrl,
    dashboardUrl: found.dashboardUrl,
    publicRoutingMode: found.publicRoutingMode,
    region: found.region,
    activeDeploymentId: found.activeDeploymentId,
    ...(found.connectedRepository
      ? {
          connectedRepository: {
            repoFullName: found.connectedRepository.repoFullName,
            productionBranch: found.connectedRepository.productionBranch,
            githubInstallationId:
              found.connectedRepository.githubInstallationId,
            watchPaths: found.connectedRepository.watchPaths,
            deployBranchPatterns:
              found.connectedRepository.deployBranchPatterns,
            waitForCi: found.connectedRepository.waitForCi,
          },
        }
      : {}),
  };
  return { ...project, server: found.id, details };
}

/** Read a value from a pipe without prompting. */
export async function stdinText(): Promise<string> {
  if (process.stdin.isTTY)
    throw new UsageError("Pipe the sensitive value through stdin.");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<unknown>) {
    if (typeof chunk === "string" || chunk instanceof Uint8Array)
      chunks.push(Buffer.from(chunk));
    else throw new UsageError("Could not read the piped value.");
  }
  return Buffer.concat(chunks).toString("utf8");
}
