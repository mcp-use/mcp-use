import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify, parseArgs } from "node:util";

import { cloudApiForOrganization } from "./cloud-api.js";
import {
  CommandError,
  confirm,
  openBrowser,
  pathExists,
  printResult,
  readJson,
  reportError,
  UsageError,
  wantsJson,
  writePrivateJson,
} from "./shared.js";

const exec = promisify(execFile);

interface ProjectLink {
  organizationId: string;
  serverId: string;
  serverSlug?: string | null;
  repository: string;
}

interface Installation {
  installationId: string;
  account?: { login?: string | null } | null;
}

/** Run `mcp-use deploy`. */
export async function runDeploy(argv: readonly string[]): Promise<number> {
  const json = wantsJson(argv);
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        org: { type: "string" },
        name: { type: "string" },
        branch: { type: "string" },
        "root-dir": { type: "string" },
        region: { type: "string" },
        env: { type: "string", multiple: true },
        "env-file": { type: "string" },
        "build-command": { type: "string" },
        "start-command": { type: "string" },
        dockerfile: { type: "string" },
        new: { type: "boolean" },
        open: { type: "boolean" },
        yes: { type: "boolean" },
        json: { type: "boolean" },
      },
    });
    if (positionals.length > 1) {
      throw new UsageError("Usage: mcp-use deploy [path] [options]");
    }
    const cwd = resolve(positionals[0] ?? process.cwd());
    const repositoryRoot = await git(cwd, ["rev-parse", "--show-toplevel"]);
    const remote = await git(repositoryRoot, ["remote", "get-url", "origin"]);
    const repository = parseGitHubRepository(remote);
    const branch =
      values.branch ??
      (await git(repositoryRoot, ["branch", "--show-current"]));
    if (branch === "") {
      throw new CommandError(
        "detached_head",
        "Cannot infer a branch from detached HEAD; pass --branch."
      );
    }
    validateRepositoryPath(repositoryRoot, values["root-dir"], "--root-dir");
    validateRepositoryPath(repositoryRoot, values.dockerfile, "--dockerfile");

    const { api, organizationId } = await cloudApiForOrganization(values.org);
    const linkPath = join(cwd, ".mcp-use", "cloud", "link.json");
    const existing = await readJson<ProjectLink | null>(linkPath, null);
    const createNew = values.new === true || existing === null;
    if (values.new === true) {
      const accepted = await confirm(
        "Create a new cloud server for this project?",
        {
          yes: values.yes === true,
          json,
        }
      );
      if (!accepted) return 0;
    }

    let serverId: string;
    let serverSlug: string | null | undefined;
    let deploymentId: string;
    if (!createNew && existing !== null) {
      if (existing.organizationId !== organizationId) {
        throw new CommandError(
          "organization_mismatch",
          "The linked server belongs to another organization. Pass --new to create one."
        );
      }
      serverId = existing.serverId;
      serverSlug = existing.serverSlug;
      const deployment = await api.request<{ id: string }>("/deployments", {
        method: "POST",
        body: JSON.stringify({
          serverId,
          branch,
          trigger: "manual",
        }),
      });
      deploymentId = deployment.id;
    } else {
      const installations = await api.request<{
        installations: Installation[];
      }>(
        `/github/installations?organizationId=${encodeURIComponent(organizationId)}`
      );
      const installation = await installationFor(
        api,
        installations.installations,
        repository
      );
      if (installation === undefined) {
        throw new CommandError(
          "github_access_required",
          `The mcp-use GitHub App cannot access ${repository}. Configure repository access in the cloud dashboard and retry.`
        );
      }
      const env = await loadEnvironment(
        cwd,
        values["env-file"],
        values.env ?? []
      );
      const created = await api.request<{
        server: { id: string; slug: string | null };
        deploymentId: string | null;
      }>("/servers", {
        method: "POST",
        body: JSON.stringify({
          type: "github",
          organizationId,
          installationId: installation.installationId,
          name: values.name ?? basename(repository),
          repoFullName: repository,
          branch,
          ...(values["root-dir"] !== undefined
            ? { rootDir: values["root-dir"] }
            : {}),
          ...(values.region !== undefined ? { region: values.region } : {}),
          ...(values["build-command"] !== undefined
            ? { buildCommand: values["build-command"] }
            : {}),
          ...(values["start-command"] !== undefined
            ? { startCommand: values["start-command"] }
            : {}),
          ...(values.dockerfile !== undefined
            ? { dockerfilePath: values.dockerfile }
            : {}),
          ...(Object.keys(env).length > 0 ? { env } : {}),
        }),
      });
      if (created.deploymentId === null) {
        throw new CommandError(
          "deployment_not_created",
          "Server was created but no deployment was started.",
          { serverId: created.server.id }
        );
      }
      serverId = created.server.id;
      serverSlug = created.server.slug;
      deploymentId = created.deploymentId;
      await writePrivateJson(linkPath, {
        organizationId,
        serverId,
        serverSlug,
        repository,
      } satisfies ProjectLink);
    }

    const webUrl = `${
      process.env["MCP_USE_CLOUD_WEB_URL"] ?? "https://manufact.com"
    }/${encodeURIComponent(serverSlug ?? serverId)}`;
    const result = { serverId, deploymentId, status: "pending", webUrl };
    if (values.open === true) openBrowser(webUrl);
    printResult(
      result,
      json,
      `Deployment ${deploymentId} started for ${repository}.`
    );
    return 0;
  } catch (error) {
    return reportError(
      error instanceof TypeError ? new UsageError(error.message) : error,
      json
    );
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, { cwd });
    return stdout.trim();
  } catch {
    throw new CommandError(
      "git_required",
      `Could not run git ${args.join(" ")} in ${cwd}.`
    );
  }
}

function parseGitHubRepository(remote: string): string {
  const match = remote.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new CommandError(
      "unsupported_remote",
      "The origin remote must be a GitHub repository."
    );
  }
  return `${match[1]}/${match[2]}`;
}

async function installationFor(
  api: Awaited<ReturnType<typeof cloudApiForOrganization>>["api"],
  installations: Installation[],
  repository: string
): Promise<Installation | undefined> {
  const [owner, repo] = repository.split("/") as [string, string];
  const ordered = [...installations].sort((left, right) => {
    const leftMatch =
      left.account?.login?.toLowerCase() === owner.toLowerCase();
    const rightMatch =
      right.account?.login?.toLowerCase() === owner.toLowerCase();
    return Number(rightMatch) - Number(leftMatch);
  });
  for (const installation of ordered) {
    try {
      const access = await api.request<{ hasAccess: boolean }>(
        `/github/installations/${encodeURIComponent(installation.installationId)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/access`
      );
      if (access.hasAccess) return installation;
    } catch {
      // Try the next installation.
    }
  }
  return undefined;
}

function validateRepositoryPath(
  repositoryRoot: string,
  value: string | undefined,
  option: string
): void {
  if (value === undefined) return;
  if (isAbsolute(value))
    throw new UsageError(`${option} must be repository-relative.`);
  const target = resolve(repositoryRoot, value);
  const path = relative(repositoryRoot, target);
  if (path.startsWith("..") || isAbsolute(path)) {
    throw new UsageError(`${option} must not escape the repository.`);
  }
}

async function loadEnvironment(
  cwd: string,
  envFile: string | undefined,
  assignments: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (envFile !== undefined) {
    const path = resolve(cwd, envFile);
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
  if (separator <= 0)
    throw new UsageError(`Invalid environment value: ${assignment}`);
  target[assignment.slice(0, separator)] = assignment.slice(separator + 1);
}
