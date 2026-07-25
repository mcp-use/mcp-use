import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  appendFile,
  lstat,
  opendir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs, promisify } from "node:util";
import { createGzip } from "node:zlib";

import {
  cloudApiForOrganization,
  cloudWebUrl,
  type CloudApi,
} from "./cloud-api.js";
import {
  CommandError,
  CommandUsageError,
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
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".vercel",
  ".cache",
  ".parcel-cache",
  ".pytest_cache",
  ".ruff_cache",
  ".mypy_cache",
  "__pycache__",
  ".venv",
  "venv",
  "coverage",
  ".nyc_output",
  ".output",
  "out",
  "target",
  ".mcp-use",
]);

const HELP = `Deploy an MCP server to Manufact Cloud.

Usage:
  mcp-use deploy [path] [options]

Source modes:
  GitHub (default)   Deploy the current origin. If none exists, an interactive
                     run can create a private repository; --yes authorizes the
                     same flow without prompts.
  Managed upload     Pass --no-github on the first deploy to upload local
                     source. Linked managed projects auto-detect this on retry.

Options:
  --org <id-or-slug>       Target organization (default: active organization)
  --name <name>            Cloud server/repository name (default: project name)
  --branch <name>          Branch (default: current Git branch, or main)
  --root-dir <path>        Project root inside the repository/upload directory
  --region <region>        Cloud region identifier
  --env <KEY=VALUE>        Environment variable; repeatable
  --env-file <path>        Load environment variables from a file
  --build-command <cmd>    Override the build command
  --start-command <cmd>    Override the start command
  --dockerfile <path>      Dockerfile path relative to the selected source root
  --watch-paths <glob>     GitHub auto-deploy path filter; repeatable
  --wait-for-ci            Wait for other GitHub checks before auto-deploy
  --no-github              Upload local source to a managed private repository
  --new                    Create a new server instead of using the local link
  --open                   Open the server page after a successful deployment
  -y, --yes                Authorize confirmations and Git/repository mutations
  --json                   Emit exactly one JSON result or error; never prompt
  -h, --help               Show this help without Git, auth, or network access

Automation:
  --json does not authorize mutations. Use --json --yes for headless GitHub
  repository creation, or --json --no-github for a managed source upload.
  --new requires --yes in JSON or non-interactive environments.

Incompatible combinations:
  --open cannot be combined with --json because JSON mode never opens a browser.
  --no-github cannot replace a linked GitHub server in place; add --new --yes
  to create a separate managed-source server.
  --watch-paths and --wait-for-ci are GitHub-only.

Managed archive:
  Uploads the selected project without .git, dependencies, build output,
  .mcp-use, .env*, caches, coverage, OS metadata, or symbolic links.
  The compressed archive limit is 80 MB.

Examples:
  mcp-use deploy
  mcp-use deploy --yes
  mcp-use deploy --no-github
  mcp-use deploy --no-github --json
  mcp-use deploy --json --yes
  mcp-use deploy --env-file .env.production --open

Exit codes:
  0  Success or help
  1  Git, API, upload, or deployment failure
  2  Invalid arguments or an explicit headless choice is required`;

interface ProjectLink {
  organizationId: string;
  serverId: string;
  serverSlug?: string | null;
  repository?: string;
  sourceType?: "github" | "managed";
}

interface Installation {
  id?: string;
  installationId: string;
  account?: {
    login?: string | null;
    type?: string | null;
  } | null;
}

interface GitProbe {
  isRepository: boolean;
  root?: string;
  remote?: string;
  branch?: string;
  dirty?: boolean;
  unavailable?: boolean;
}

interface DeployValues {
  org?: string;
  name?: string;
  branch?: string;
  "root-dir"?: string;
  region?: string;
  env?: string[];
  "env-file"?: string;
  "build-command"?: string;
  "start-command"?: string;
  dockerfile?: string;
  "watch-paths"?: string[];
  "wait-for-ci"?: boolean;
  "no-github"?: boolean;
  new?: boolean;
  open?: boolean;
  yes?: boolean;
  json?: boolean;
  help?: boolean;
}

interface CreatedServer {
  server: { id: string; slug: string | null };
  deploymentId: string | null;
}

/** Run `mcp-use deploy`. */
export async function runDeploy(argv: readonly string[]): Promise<number> {
  const json = wantsJson(argv);
  try {
    const { values, positionals } = parseDeployArguments(argv);
    if (values.help === true) {
      process.stdout.write(`${HELP}\n`);
      return 0;
    }
    if (values.json === true && values.open === true) {
      throw new CommandUsageError(
        "invalid_argument_combination",
        "--open cannot be combined with --json; JSON mode never opens a browser.",
        {
          nextSteps: [
            {
              description: "Deploy as JSON without opening a browser",
              command: "mcp-use deploy --json",
            },
            {
              description: "Deploy and open the server page interactively",
              command: "mcp-use deploy --open",
            },
          ],
        }
      );
    }

    const cwd = resolve(positionals[0] ?? process.cwd());
    const linkPath = join(cwd, ".mcp-use", "cloud", "link.json");

    if (values.new === true) {
      const accepted = await confirm(
        "Create a new cloud server for this project?",
        { yes: values.yes === true, json }
      );
      if (!accepted) return 0;
    }

    const { api, organizationId } = await cloudApiForOrganization(values.org);
    const existing = await readJson<ProjectLink | null>(linkPath, null);
    const createNew = values.new === true || existing === null;
    if (
      !createNew &&
      existing !== null &&
      existing.organizationId !== organizationId
    ) {
      throw new CommandError(
        "organization_mismatch",
        "The linked server belongs to another organization. Pass --new --yes to create one.",
        {
          nextSteps: [
            {
              description: "Create a server in the selected organization",
              command: "mcp-use deploy --new --yes",
            },
          ],
        }
      );
    }

    const linkedManaged =
      !createNew &&
      existing !== null &&
      (await linkedServerIsManaged(api, existing));
    if (
      values["no-github"] === true &&
      !createNew &&
      existing !== null &&
      !linkedManaged
    ) {
      throw new CommandUsageError(
        "source_mode_conflict",
        "This project is linked to a GitHub-backed server; managed upload cannot replace its source in place.",
        {
          serverId: existing.serverId,
          nextSteps: [
            {
              description: "Redeploy the linked GitHub server",
              command: "mcp-use deploy",
            },
            {
              description: "Create a separate managed-source server",
              command: "mcp-use deploy --no-github --new --yes",
            },
          ],
        }
      );
    }
    const managed = values["no-github"] === true || linkedManaged;

    if (managed) {
      if (
        values["watch-paths"] !== undefined ||
        values["wait-for-ci"] === true
      ) {
        throw new CommandUsageError(
          "source_mode_conflict",
          "--watch-paths and --wait-for-ci are available only for GitHub deployments.",
          {
            nextSteps: [
              {
                description:
                  "Upload managed source without GitHub trigger options",
                command: "mcp-use deploy --no-github",
              },
              {
                description: "Deploy through GitHub with trigger options",
                command: "mcp-use deploy --yes --watch-paths <glob>",
              },
            ],
          }
        );
      }
      return await deployManaged({
        api,
        organizationId,
        cwd,
        linkPath,
        existing: createNew ? null : existing,
        values,
        json,
      });
    }

    return await deployGitHub({
      api,
      organizationId,
      cwd,
      linkPath,
      existing: createNew ? null : existing,
      values,
      json,
    });
  } catch (error) {
    return reportError(
      error instanceof TypeError ? new UsageError(error.message) : error,
      json
    );
  }
}

function parseDeployArguments(argv: readonly string[]): {
  values: DeployValues;
  positionals: string[];
} {
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
      "watch-paths": { type: "string", multiple: true },
      "wait-for-ci": { type: "boolean" },
      "no-github": { type: "boolean" },
      new: { type: "boolean" },
      open: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (positionals.length > 1) {
    throw new UsageError("Usage: mcp-use deploy [path] [options]");
  }
  if (values["watch-paths"] !== undefined) {
    values["watch-paths"] = normalizeDeployPatterns(values["watch-paths"]);
  }
  return { values, positionals };
}

function normalizeDeployPatterns(values: string[]): string[] {
  if (values.length === 1 && values[0] === "") return [];
  if (values.length > 32) {
    throw new UsageError("--watch-paths accepts at most 32 patterns.");
  }
  if (values.some((value) => value === "")) {
    throw new UsageError(
      "--watch-paths accepts an empty value only by itself to clear all patterns."
    );
  }
  if (values.some((value) => value.length > 512)) {
    throw new UsageError(
      "--watch-paths patterns may not exceed 512 characters."
    );
  }
  return values;
}

async function deployManaged(input: {
  api: CloudApi;
  organizationId: string;
  cwd: string;
  linkPath: string;
  existing: ProjectLink | null;
  values: DeployValues;
  json: boolean;
}): Promise<number> {
  const { api, organizationId, cwd, linkPath, existing, values, json } = input;
  const projectRoot = cwd;
  const sourceRoot = resolveContainedPath(
    cwd,
    values["root-dir"] ?? ".",
    "--root-dir"
  );
  if (!(await pathExists(sourceRoot))) {
    throw new UsageError(`Project directory not found: ${sourceRoot}`);
  }
  validateSourcePath(sourceRoot, values.dockerfile, "--dockerfile");
  await validateManagedPackage(projectRoot);

  const env = await loadEnvironment(
    projectRoot,
    values["env-file"],
    values.env ?? []
  );
  const archive = await packProject(projectRoot);
  assertManagedArchiveSize(archive.byteLength);

  const branch = values.branch ?? "main";
  const name = values.name ?? (await projectName(sourceRoot));
  let serverId: string;
  let serverSlug: string | null | undefined;
  let deploymentId: string;

  if (existing !== null) {
    serverId = existing.serverId;
    serverSlug = existing.serverSlug;
    await syncServerConfiguration(api, serverId, values);
    await syncEnvironment(api, serverId, env, values.branch);
    const sourceForm = new FormData();
    appendArchive(sourceForm, archive);
    sourceForm.set("branch", branch);
    sourceForm.set("commitMessage", "Redeploy from mcp-use CLI");
    await api.multipartRequest(
      `/servers/${encodeURIComponent(serverId)}/source`,
      sourceForm
    );
    const deployment = await api.request<{ id: string }>("/deployments", {
      method: "POST",
      body: JSON.stringify({ serverId, branch, trigger: "redeploy" }),
    });
    deploymentId = deployment.id;
  } else {
    const form = new FormData();
    appendArchive(form, archive);
    form.set("organizationId", organizationId);
    form.set("managed", "true");
    form.set("name", name);
    form.set("repoName", sanitizeRepositoryName(name));
    form.set("private", "true");
    form.set("branch", branch);
    form.set("commitMessage", "Deploy from mcp-use CLI");
    if (values.region !== undefined) form.set("region", values.region);
    if (values["root-dir"] !== undefined) {
      form.set("rootDir", values["root-dir"]);
    }
    if (values["build-command"] !== undefined) {
      form.set("buildCommand", values["build-command"]);
    }
    if (values["start-command"] !== undefined) {
      form.set("startCommand", values["start-command"]);
    }
    if (values.dockerfile !== undefined) {
      form.set("dockerfilePath", values.dockerfile);
    }
    if (Object.keys(env).length > 0) form.set("env", JSON.stringify(env));

    const created = await api.multipartRequest<CreatedServer>("/servers", form);
    if (created.deploymentId === null) {
      throw deploymentNotCreated(created.server.id);
    }
    serverId = created.server.id;
    serverSlug = created.server.slug;
    deploymentId = created.deploymentId;
  }

  await writePrivateJson(linkPath, {
    organizationId,
    serverId,
    ...(serverSlug !== undefined ? { serverSlug } : {}),
    sourceType: "managed",
  } satisfies ProjectLink);
  await ensureLocalMcpUseIgnored(projectRoot);
  return finishDeployment({
    sourceType: "managed",
    serverId,
    ...(serverSlug !== undefined ? { serverSlug } : {}),
    deploymentId,
    label: "managed source",
    values,
    json,
  });
}

/** Validate the compressed upload size before making a multipart request. */
export function assertManagedArchiveSize(sizeBytes: number): void {
  if (sizeBytes <= MAX_ARCHIVE_BYTES) return;
  throw new CommandError(
    "archive_too_large",
    `Project archive is ${(sizeBytes / 1024 / 1024).toFixed(2)} MB; the maximum is 80 MB.`,
    {
      sizeBytes,
      maxBytes: MAX_ARCHIVE_BYTES,
      nextSteps: [
        {
          description: "Exclude large generated files and retry",
          command: "mcp-use deploy --no-github",
        },
      ],
    }
  );
}

async function deployGitHub(input: {
  api: CloudApi;
  organizationId: string;
  cwd: string;
  linkPath: string;
  existing: ProjectLink | null;
  values: DeployValues;
  json: boolean;
}): Promise<number> {
  const { api, organizationId, cwd, linkPath, existing, values, json } = input;
  let probe = await probeGit(cwd);
  let repository: string;
  let installation: Installation | undefined;

  if (!probe.isRepository || probe.remote === undefined) {
    if (probe.unavailable === true) {
      throw new CommandError(
        "git_unavailable",
        "Git is not installed or could not be executed.",
        {
          nextSteps: [
            {
              description: "Deploy without GitHub",
              command: "mcp-use deploy --no-github",
            },
          ],
        }
      );
    }
    await authorizeRepositoryBootstrap(values, json);
    const installations = await listInstallations(api, organizationId);
    installation = await selectInstallation(installations, values, json);
    const name = values.name ?? (await projectName(cwd));
    const repositoryName = sanitizeRepositoryName(name);
    let created: {
      fullName: string;
      cloneUrl: string;
      htmlUrl: string;
    };
    try {
      created = await api.request<{
        fullName: string;
        cloneUrl: string;
        htmlUrl: string;
      }>(
        `/github/installations/${encodeURIComponent(installation.installationId)}/repos`,
        {
          method: "POST",
          body: JSON.stringify({
            name: repositoryName,
            private: true,
            org: installation.account?.login ?? undefined,
          }),
        }
      );
    } catch (error) {
      throw new CommandError(
        "github_repository_creation_failed",
        `Could not create the private GitHub repository ${repositoryName}.`,
        {
          account: installation.account?.login ?? null,
          cause: error instanceof Error ? error.message : String(error),
          nextSteps: [
            {
              description: "Retry with a unique repository name",
              command: "mcp-use deploy --name <unique-name> --yes",
            },
            {
              description: "Deploy without GitHub",
              command: "mcp-use deploy --no-github",
            },
          ],
        }
      );
    }
    try {
      await bootstrapRepository(cwd, probe, created.cloneUrl);
    } catch (error) {
      const normalized =
        error instanceof CommandError
          ? error
          : normalizeGitMutationError(error, cwd);
      const details =
        normalized.details !== null &&
        typeof normalized.details === "object" &&
        !Array.isArray(normalized.details)
          ? normalized.details
          : {};
      const nextSteps = commandNextSteps(normalized.details);
      if (!nextSteps.some((step) => step.command === "mcp-use deploy --yes")) {
        nextSteps.push({
          description: "Retry using the repository already created",
          command: "mcp-use deploy --yes",
        });
      }
      throw new CommandError(normalized.code, normalized.message, {
        ...details,
        repository: created.fullName,
        url: created.htmlUrl,
        nextSteps,
      });
    }
    probe = await probeGit(cwd);
    repository = created.fullName;
  } else {
    repository = parseGitHubRepository(probe.remote);
  }

  const repositoryRoot = probe.root ?? cwd;
  const branch = values.branch ?? probe.branch;
  if (branch === undefined || branch === "" || branch === "HEAD") {
    throw new CommandError(
      "detached_head",
      "Cannot infer a branch from detached HEAD; pass --branch.",
      {
        nextSteps: [
          {
            description: "Deploy an explicit branch",
            command: "mcp-use deploy --branch <branch>",
          },
        ],
      }
    );
  }
  validateSourcePath(repositoryRoot, values["root-dir"], "--root-dir");
  validateSourcePath(repositoryRoot, values.dockerfile, "--dockerfile");
  const env = await loadEnvironment(cwd, values["env-file"], values.env ?? []);

  if (probe.dirty === true) {
    await handleDirtyRepository(repositoryRoot, branch, values, json);
  }

  let serverId: string;
  let serverSlug: string | null | undefined;
  let deploymentId: string;
  if (existing !== null) {
    serverId = existing.serverId;
    serverSlug = existing.serverSlug;
    await syncServerConfiguration(api, serverId, values);
    await syncEnvironment(api, serverId, env, values.branch);
    const deployment = await api.request<{ id: string }>("/deployments", {
      method: "POST",
      body: JSON.stringify({ serverId, branch, trigger: "manual" }),
    });
    deploymentId = deployment.id;
  } else {
    const installations =
      installation === undefined
        ? await listInstallations(api, organizationId)
        : [installation];
    installation ??= await installationFor(api, installations, repository);
    if (installation === undefined) {
      const settingsUrl = `${cloudWebUrl()}/settings`;
      throw new CommandError(
        installations.length === 0
          ? "github_installation_required"
          : "github_access_required",
        installations.length === 0
          ? "No GitHub App installation is connected to this organization."
          : `The mcp-use GitHub App cannot access ${repository}.`,
        {
          repository,
          url: settingsUrl,
          nextSteps: [
            {
              description: "Configure GitHub access",
              command: settingsUrl,
            },
            {
              description: "Retry deployment",
              command: "mcp-use deploy",
            },
          ],
        }
      );
    }
    const created = await api.request<CreatedServer>("/servers", {
      method: "POST",
      body: JSON.stringify({
        type: "github",
        organizationId,
        installationId: installation.id ?? installation.installationId,
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
        ...(values["watch-paths"] !== undefined
          ? { watchPaths: values["watch-paths"] }
          : {}),
        ...(values["wait-for-ci"] !== undefined
          ? { waitForCi: values["wait-for-ci"] }
          : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      }),
    });
    if (created.deploymentId === null) {
      throw deploymentNotCreated(created.server.id);
    }
    serverId = created.server.id;
    serverSlug = created.server.slug;
    deploymentId = created.deploymentId;
  }

  await writePrivateJson(linkPath, {
    organizationId,
    serverId,
    ...(serverSlug !== undefined ? { serverSlug } : {}),
    repository,
    sourceType: "github",
  } satisfies ProjectLink);
  await ensureLocalMcpUseIgnored(repositoryRoot);
  return finishDeployment({
    sourceType: "github",
    serverId,
    ...(serverSlug !== undefined ? { serverSlug } : {}),
    deploymentId,
    label: repository,
    values,
    json,
  });
}

async function syncEnvironment(
  api: CloudApi,
  serverId: string,
  environment: Record<string, string>,
  branch: string | undefined
): Promise<void> {
  if (Object.keys(environment).length === 0) return;
  const query =
    branch === undefined ? "" : `?branch=${encodeURIComponent(branch)}`;
  const existing = await api.request<
    Array<{ id: string; key: string; branch?: string | null }>
  >(`/servers/${encodeURIComponent(serverId)}/env-variables${query}`);
  const byKey = new Map(existing.map((variable) => [variable.key, variable]));
  await Promise.all(
    Object.entries(environment).map(async ([key, value]) => {
      const variable = byKey.get(key);
      const body = JSON.stringify({
        key,
        value,
        branch: branch ?? null,
        environments: branch === undefined ? ["production"] : ["preview"],
      });
      if (variable === undefined) {
        await api.request(
          `/servers/${encodeURIComponent(serverId)}/env-variables`,
          { method: "POST", body }
        );
      } else {
        await api.request(
          `/servers/${encodeURIComponent(serverId)}/env-variables/${encodeURIComponent(variable.id)}`,
          { method: "PATCH", body }
        );
      }
    })
  );
}

async function syncServerConfiguration(
  api: CloudApi,
  serverId: string,
  values: DeployValues
): Promise<void> {
  const config = {
    ...(values["root-dir"] !== undefined
      ? { rootDir: values["root-dir"] }
      : {}),
    ...(values["build-command"] !== undefined
      ? { buildCommand: values["build-command"] }
      : {}),
    ...(values["start-command"] !== undefined
      ? { startCommand: values["start-command"] }
      : {}),
    ...(values.dockerfile !== undefined
      ? { dockerfilePath: values.dockerfile }
      : {}),
  };
  const body = {
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.branch !== undefined ? { productionBranch: values.branch } : {}),
    ...(values.region !== undefined ? { region: values.region } : {}),
    ...(values["watch-paths"] !== undefined
      ? { watchPaths: values["watch-paths"] }
      : {}),
    ...(values["wait-for-ci"] !== undefined
      ? { waitForCi: values["wait-for-ci"] }
      : {}),
    ...(Object.keys(config).length > 0 ? { config } : {}),
  };
  if (Object.keys(body).length === 0) return;
  await api.request(`/servers/${encodeURIComponent(serverId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function linkedServerIsManaged(
  api: CloudApi,
  link: ProjectLink
): Promise<boolean> {
  if (link.sourceType !== undefined) return link.sourceType === "managed";
  if (link.repository === undefined) return true;
  try {
    const server = await api.request<{
      connectedRepository?: { isManaged?: boolean } | null;
    }>(`/servers/${encodeURIComponent(link.serverId)}`);
    return server.connectedRepository?.isManaged === true;
  } catch {
    return false;
  }
}

async function authorizeRepositoryBootstrap(
  values: DeployValues,
  json: boolean
): Promise<void> {
  if (values.yes === true) return;
  if (json || !process.stdin.isTTY) {
    throw new CommandUsageError(
      "deployment_mode_required",
      "No GitHub origin was found. Choose a deployment mode explicitly.",
      {
        nextSteps: [
          {
            description: "Upload local source without GitHub",
            command: "mcp-use deploy --no-github",
          },
          {
            description: "Create a private GitHub repository and push",
            command: "mcp-use deploy --yes",
          },
        ],
      }
    );
  }
  const accepted = await promptYesNo(
    "No GitHub origin was found. Create a private repository and push this project?",
    true
  );
  if (!accepted) {
    throw new CommandUsageError(
      "deployment_mode_required",
      "Deployment cancelled. Choose a deployment mode.",
      {
        nextSteps: [
          {
            description: "Upload local source without GitHub",
            command: "mcp-use deploy --no-github",
          },
          {
            description: "Retry GitHub setup",
            command: "mcp-use deploy",
          },
        ],
      }
    );
  }
}

async function listInstallations(
  api: CloudApi,
  organizationId: string
): Promise<Installation[]> {
  const response = await api.request<{ installations: Installation[] }>(
    `/github/installations?organizationId=${encodeURIComponent(organizationId)}`
  );
  if (response.installations.length === 0) {
    const settingsUrl = `${cloudWebUrl()}/settings`;
    throw new CommandError(
      "github_installation_required",
      "No GitHub App installation is connected to this organization.",
      {
        url: settingsUrl,
        nextSteps: [
          {
            description: "Connect GitHub in the cloud dashboard",
            command: settingsUrl,
          },
          {
            description: "Retry deployment after connecting GitHub",
            command: "mcp-use deploy",
          },
          {
            description: "Deploy without GitHub",
            command: "mcp-use deploy --no-github",
          },
        ],
      }
    );
  }
  return response.installations;
}

async function selectInstallation(
  installations: Installation[],
  values: DeployValues,
  json: boolean
): Promise<Installation> {
  const ordered = [...installations].sort((left, right) => {
    const leftOrg = left.account?.type?.toLowerCase() === "organization";
    const rightOrg = right.account?.type?.toLowerCase() === "organization";
    return Number(rightOrg) - Number(leftOrg);
  });
  if (ordered.length === 1 || values.yes === true) return ordered[0]!;
  if (json || !process.stdin.isTTY) {
    throw new CommandUsageError(
      "github_installation_required",
      "Multiple GitHub installations are available; pass --yes to select deterministically.",
      {
        nextSteps: [
          {
            description: "Use the default organization installation",
            command: "mcp-use deploy --yes",
          },
        ],
      }
    );
  }

  process.stdout.write("Choose the GitHub account for the new repository:\n");
  for (const [index, installation] of ordered.entries()) {
    process.stdout.write(
      `  ${index + 1}. ${installation.account?.login ?? installation.installationId}\n`
    );
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question("Account [1]: ");
    const index = answer.trim() === "" ? 0 : Number(answer) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= ordered.length) {
      throw new UsageError("Invalid GitHub account selection.");
    }
    return ordered[index]!;
  } finally {
    prompt.close();
  }
}

async function bootstrapRepository(
  cwd: string,
  probe: GitProbe,
  cloneUrl: string
): Promise<void> {
  try {
    await ensureMcpUseIgnored(cwd);
    if (!probe.isRepository) {
      await mutateGit(cwd, ["init"]);
    }
    // Persist the created repository identity before committing. If identity,
    // commit, or push fails, the next deploy sees origin and reuses this repo
    // instead of creating another one.
    await mutateGit(cwd, ["remote", "add", "origin", cloneUrl]);
    await mutateGit(cwd, ["add", "."]);
    const staged = await readGit(cwd, ["diff", "--cached", "--quiet"]);
    if (!staged.ok) {
      await mutateGit(cwd, ["commit", "-m", "Initial commit"]);
    }
    await mutateGit(cwd, ["branch", "-M", "main"]);
    await mutateGit(cwd, ["push", "-u", "origin", "main"]);
  } catch (error) {
    throw normalizeGitMutationError(error, cwd);
  }
}

function commandNextSteps(
  details: unknown
): Array<{ description: string; command: string }> {
  if (details === null || typeof details !== "object") {
    return [];
  }
  const rawNextSteps = (details as Record<string, unknown>)["nextSteps"];
  if (!Array.isArray(rawNextSteps)) return [];
  const nextSteps: unknown[] = rawNextSteps;
  return nextSteps.filter(
    (
      step
    ): step is {
      description: string;
      command: string;
    } =>
      step !== null &&
      typeof step === "object" &&
      "description" in step &&
      typeof step.description === "string" &&
      "command" in step &&
      typeof step.command === "string"
  );
}

async function ensureMcpUseIgnored(cwd: string): Promise<void> {
  const path = join(cwd, ".gitignore");
  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .includes(".mcp-use/")
  ) {
    return;
  }
  if (contents === "") {
    await writeFile(path, ".mcp-use/\n", "utf8");
  } else {
    await appendFile(path, `${contents.endsWith("\n") ? "" : "\n"}.mcp-use/\n`);
  }
}

async function ensureLocalMcpUseIgnored(cwd: string): Promise<void> {
  const excludePath = join(cwd, ".git", "info", "exclude");
  if (!(await pathExists(excludePath))) return;
  try {
    const contents = await readFile(excludePath, "utf8");
    if (
      contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .includes(".mcp-use/")
    ) {
      return;
    }
    await appendFile(
      excludePath,
      `${contents.endsWith("\n") || contents === "" ? "" : "\n"}.mcp-use/\n`
    );
  } catch {
    // A completed cloud deployment must not be turned into a failure merely
    // because the repository's optional local exclude file is read-only.
  }
}

async function handleDirtyRepository(
  cwd: string,
  branch: string,
  values: DeployValues,
  json: boolean
): Promise<void> {
  if (values.yes !== true) {
    if (json || !process.stdin.isTTY) {
      throw new CommandUsageError(
        "git_changes_require_confirmation",
        "The repository has uncommitted changes.",
        {
          nextSteps: [
            {
              description: "Authorize committing and pushing the changes",
              command: "mcp-use deploy --yes",
            },
            {
              description: "Commit the changes yourself",
              command: "git add . && git commit && git push",
            },
          ],
        }
      );
    }
    const accepted = await promptYesNo(
      "Commit and push the current changes before deploying?",
      true
    );
    if (!accepted) return;
  }
  try {
    await mutateGit(cwd, ["add", "."]);
    await mutateGit(cwd, ["commit", "-m", "Deploy changes"]);
    await mutateGit(cwd, ["push", "origin", branch]);
  } catch (error) {
    throw normalizeGitMutationError(error, cwd);
  }
}

async function probeGit(cwd: string): Promise<GitProbe> {
  const inside = await readGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok) {
    if (inside.unavailable !== true && !isNotGitRepository(inside)) {
      throw gitProbeError("git rev-parse --is-inside-work-tree", inside);
    }
    return {
      isRepository: false,
      ...(inside.unavailable !== undefined
        ? { unavailable: inside.unavailable }
        : {}),
    };
  }
  const [root, remote, branch, status] = await Promise.all([
    readGit(cwd, ["rev-parse", "--show-toplevel"]),
    readGit(cwd, ["remote", "get-url", "origin"]),
    readGit(cwd, ["branch", "--show-current"]),
    readGit(cwd, ["status", "--porcelain"]),
  ]);
  if (!root.ok || root.stdout === "") {
    throw gitProbeError("git rev-parse --show-toplevel", root);
  }
  if (!remote.ok && !isMissingOrigin(remote)) {
    throw gitProbeError("git remote get-url origin", remote);
  }
  if (!branch.ok) {
    throw gitProbeError("git branch --show-current", branch);
  }
  if (!status.ok) {
    throw gitProbeError("git status --porcelain", status);
  }
  return {
    isRepository: true,
    root: root.stdout,
    ...(remote.ok && remote.stdout !== "" ? { remote: remote.stdout } : {}),
    ...(branch.ok ? { branch: branch.stdout } : {}),
    dirty: status.ok && status.stdout !== "",
  };
}

async function readGit(
  cwd: string,
  args: string[]
): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  unavailable?: boolean;
  code?: number | string;
}> {
  try {
    const result = await exec("git", args, { cwd });
    return {
      ok: true,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    return {
      ok: false,
      stdout: String(failure.stdout ?? "").trim(),
      stderr: String(failure.stderr ?? failure.message ?? "").trim(),
      ...(failure.code === "ENOENT" ? { unavailable: true } : {}),
      ...(failure.code !== undefined ? { code: failure.code } : {}),
    };
  }
}

function isNotGitRepository(result: {
  stdout: string;
  stderr: string;
}): boolean {
  return /not a git repository|not inside a work tree/i.test(
    `${result.stderr}\n${result.stdout}`
  );
}

function isMissingOrigin(result: { stdout: string; stderr: string }): boolean {
  return /no such remote(?:\s+['"]?origin)?/i.test(
    `${result.stderr}\n${result.stdout}`
  );
}

function gitProbeError(
  command: string,
  result: { stdout: string; stderr: string; code?: number | string }
): CommandError {
  const cause = redactGitDiagnostic(
    result.stderr || result.stdout || "Git returned no diagnostics."
  );
  return new CommandError("git_command_failed", `${command} failed: ${cause}`, {
    command,
    ...(result.code !== undefined ? { exitCode: result.code } : {}),
    nextSteps: [
      {
        description: "Verify the repository with Git",
        command: "git status",
      },
      {
        description: "Deploy without GitHub",
        command: "mcp-use deploy --no-github",
      },
    ],
  });
}

async function mutateGit(cwd: string, args: string[]): Promise<void> {
  try {
    await exec("git", args, { cwd });
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    throw new GitMutationError(
      `git ${args.join(" ")}`,
      String(failure.stderr ?? failure.stdout ?? ""),
      failure.code
    );
  }
}

class GitMutationError extends Error {
  constructor(
    readonly command: string,
    readonly output: string,
    readonly exitCode: number | string | undefined
  ) {
    super(output.trim() || `${command} failed`);
  }
}

function normalizeGitMutationError(error: unknown, cwd: string): CommandError {
  if (!(error instanceof GitMutationError)) {
    return new CommandError(
      "git_command_failed",
      error instanceof Error ? error.message : String(error)
    );
  }
  if (
    /tell me who you are|author identity unknown|unable to auto-detect email address|empty ident (?:name|email)|user\.email|user\.name/i.test(
      error.output
    )
  ) {
    const command = redactGitDiagnostic(error.command);
    return new CommandError(
      "git_identity_required",
      "Git needs a user name and email before it can create a commit.",
      {
        command,
        nextSteps: [
          {
            description: "Set the email for this project",
            command: `git -C ${JSON.stringify(cwd)} config user.email "you@example.com"`,
          },
          {
            description: "Set the name for this project",
            command: `git -C ${JSON.stringify(cwd)} config user.name "Your Name"`,
          },
          { description: "Retry deployment", command: "mcp-use deploy --yes" },
        ],
      }
    );
  }
  if (/non-fast-forward|rejected|unrelated histories/i.test(error.output)) {
    const command = redactGitDiagnostic(error.command);
    return new CommandError(
      "git_push_rejected",
      "GitHub rejected the push because the remote branch contains other commits.",
      {
        command,
        nextSteps: [
          {
            description: "Reconcile the remote branch",
            command:
              "git pull --rebase origin main --allow-unrelated-histories && git push -u origin main",
          },
        ],
      }
    );
  }
  const command = redactGitDiagnostic(error.command);
  const output = redactGitDiagnostic(error.output.trim());
  return new CommandError(
    "git_command_failed",
    `${command} failed${output === "" ? "." : `: ${output}`}`,
    { command, exitCode: error.exitCode }
  );
}

function parseGitHubRepository(remote: string): string {
  const match = remote.match(
    /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/
  );
  if (match?.[1] === undefined || match[2] === undefined) {
    const safeRemote = redactGitDiagnostic(remote);
    throw new CommandError(
      "unsupported_remote",
      `The origin remote is not a supported GitHub repository: ${safeRemote}`,
      {
        remote: safeRemote,
        nextSteps: [
          {
            description: "Set a GitHub origin",
            command:
              "git remote set-url origin https://github.com/<owner>/<repo>.git",
          },
          {
            description: "Deploy without GitHub",
            command: "mcp-use deploy --no-github",
          },
        ],
      }
    );
  }
  return `${match[1]}/${match[2]}`;
}

function redactGitDiagnostic(value: string): string {
  return value.replace(
    /\b(https?:\/\/)[^/@\s]+(?::[^@\s]*)?@/gi,
    "$1[REDACTED]@"
  );
}

async function installationFor(
  api: CloudApi,
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

async function packProject(projectRoot: string): Promise<Buffer> {
  const gzip = createGzip();
  const chunks: Buffer[] = [];
  const collecting = (async () => {
    for await (const chunk of gzip) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
  })();
  try {
    await addDirectoryToArchive(gzip, projectRoot, "");
    await writeArchiveChunk(gzip, Buffer.alloc(1024));
    gzip.end();
  } catch (error) {
    gzip.destroy(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
  await collecting;
  return Buffer.concat(chunks);
}

async function addDirectoryToArchive(
  gzip: ReturnType<typeof createGzip>,
  projectRoot: string,
  relativeDirectory: string
): Promise<void> {
  const directory = await opendir(
    relativeDirectory === ""
      ? projectRoot
      : join(projectRoot, relativeDirectory)
  );
  const entries = [];
  for await (const entry of directory) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const relativePath =
      relativeDirectory === ""
        ? entry.name
        : join(relativeDirectory, entry.name);
    if (!shouldArchive(relativePath)) continue;
    const absolutePath = join(projectRoot, relativePath);
    const stats = await lstat(absolutePath);
    const archivePath = `app/${relativePath.replaceAll("\\", "/")}`;
    const common = {
      path: archivePath,
      mode: stats.mode & 0o777,
      mtime: Math.floor(stats.mtimeMs / 1000),
    };

    if (stats.isDirectory()) {
      await writeTarHeader(gzip, { ...common, type: "directory", size: 0 });
      await addDirectoryToArchive(gzip, projectRoot, relativePath);
    } else if (stats.isFile()) {
      await writeTarHeader(gzip, {
        ...common,
        type: "file",
        size: stats.size,
      });
      for await (const chunk of createReadStream(absolutePath)) {
        await writeArchiveChunk(gzip, chunk as Buffer);
      }
      await writeTarPadding(gzip, stats.size);
    } else if (stats.isSymbolicLink()) {
      // Managed uploads intentionally omit links. A link can escape the project
      // root or point back into an excluded secret/dependency directory, and
      // extraction behavior differs between archive runtimes.
      continue;
    }
  }
}

function shouldArchive(relativePath: string): boolean {
  const segments = relativePath.split(/[/\\]/).filter(Boolean);
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) {
    return false;
  }
  const filename = segments.at(-1) ?? "";
  if (
    filename === ".DS_Store" ||
    filename === "Thumbs.db" ||
    filename === "desktop.ini"
  ) {
    return false;
  }
  return !filename.startsWith(".env");
}

interface TarEntry {
  path: string;
  mode: number;
  mtime: number;
  size: number;
  type: "file" | "directory" | "symlink";
  linkPath?: string;
}

async function writeTarHeader(
  gzip: ReturnType<typeof createGzip>,
  entry: TarEntry
): Promise<void> {
  const pax: Record<string, string> = {};
  const pathFields = splitUstarPath(entry.path);
  if (pathFields === undefined || !isAscii(entry.path)) {
    pax["path"] = entry.path;
  }
  if (
    entry.linkPath !== undefined &&
    (Buffer.byteLength(entry.linkPath) > 100 || !isAscii(entry.linkPath))
  ) {
    pax["linkpath"] = entry.linkPath;
  }
  if (Object.keys(pax).length > 0) {
    const body = Buffer.from(
      Object.entries(pax)
        .map(([key, value]) => paxRecord(key, value))
        .join("")
    );
    await writeArchiveChunk(
      gzip,
      createTarHeader({
        path: "PaxHeader/entry",
        mode: 0o644,
        mtime: entry.mtime,
        size: body.length,
        type: "pax",
      })
    );
    await writeArchiveChunk(gzip, body);
    await writeTarPadding(gzip, body.length);
  }
  await writeArchiveChunk(
    gzip,
    createTarHeader({
      ...entry,
      path: pathFields === undefined ? "app/PaxEntry" : entry.path,
      ...(entry.linkPath !== undefined &&
      (Buffer.byteLength(entry.linkPath) > 100 || !isAscii(entry.linkPath))
        ? { linkPath: "PaxLink" }
        : {}),
    })
  );
}

function createTarHeader(
  entry: Omit<TarEntry, "type"> & {
    type: TarEntry["type"] | "pax";
  }
): Buffer {
  const header = Buffer.alloc(512);
  const pathFields = splitUstarPath(entry.path) ?? {
    name: entry.path.slice(-100),
    prefix: "",
  };
  writeString(header, pathFields.name, 0, 100);
  writeOctal(header, entry.mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, entry.size, 124, 12);
  writeOctal(header, entry.mtime, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] =
    entry.type === "directory"
      ? 0x35
      : entry.type === "symlink"
        ? 0x32
        : entry.type === "pax"
          ? 0x78
          : 0x30;
  if (entry.linkPath !== undefined) {
    writeString(header, entry.linkPath, 157, 100);
  }
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);
  writeString(header, "mcp-use", 265, 32);
  writeString(header, "mcp-use", 297, 32);
  writeString(header, pathFields.prefix, 345, 155);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const encoded = checksum.toString(8).padStart(6, "0");
  header.write(encoded, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function splitUstarPath(
  path: string
): { name: string; prefix: string } | undefined {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let separator = path.lastIndexOf("/"); separator > 0; ) {
    const prefix = path.slice(0, separator);
    const name = path.slice(separator + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
    separator = path.lastIndexOf("/", separator - 1);
  }
  return undefined;
}

function paxRecord(key: string, value: string): string {
  const content = `${key}=${value}\n`;
  let length = Buffer.byteLength(content) + 3;
  while (true) {
    const record = `${length} ${content}`;
    const actual = Buffer.byteLength(record);
    if (actual === length) return record;
    length = actual;
  }
}

function isAscii(value: string): boolean {
  return Buffer.byteLength(value) === value.length;
}

function writeString(
  target: Buffer,
  value: string,
  offset: number,
  length: number
): void {
  target.write(value, offset, length, "utf8");
}

function writeOctal(
  target: Buffer,
  value: number,
  offset: number,
  length: number
): void {
  const encoded = Math.max(0, value)
    .toString(8)
    .padStart(length - 1, "0")
    .slice(-(length - 1));
  target.write(encoded, offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}

async function writeTarPadding(
  gzip: ReturnType<typeof createGzip>,
  size: number
): Promise<void> {
  const padding = (512 - (size % 512)) % 512;
  if (padding > 0) await writeArchiveChunk(gzip, Buffer.alloc(padding));
}

async function writeArchiveChunk(
  gzip: ReturnType<typeof createGzip>,
  chunk: Buffer
): Promise<void> {
  if (gzip.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      gzip.off("drain", onDrain);
      gzip.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    gzip.once("drain", onDrain);
    gzip.once("error", onError);
  });
}

function appendArchive(form: FormData, archive: Buffer): void {
  form.set(
    "sourceFile",
    new Blob([new Uint8Array(archive)], { type: "application/gzip" }),
    "source.tar.gz"
  );
}

function resolveContainedPath(
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

function validateSourcePath(
  sourceRoot: string,
  value: string | undefined,
  option: string
): void {
  if (value === undefined) return;
  resolveContainedPath(sourceRoot, value, option);
}

async function loadEnvironment(
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

async function projectName(cwd: string): Promise<string> {
  try {
    const pkg = JSON.parse(
      await readFile(join(cwd, "package.json"), "utf8")
    ) as {
      name?: unknown;
    };
    if (typeof pkg.name === "string" && pkg.name.trim() !== "") return pkg.name;
  } catch {
    // Fall back to the directory name.
  }
  return basename(cwd);
}

async function validateManagedPackage(sourceRoot: string): Promise<void> {
  const manifestPath = join(sourceRoot, "package.json");
  if (!(await pathExists(manifestPath))) return;
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return;
  }
  if (manifest["workspaces"] !== undefined) return;
  const sections = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ];
  const workspaceDependencies: string[] = [];
  for (const section of sections) {
    const dependencies = manifest[section];
    if (
      dependencies === null ||
      typeof dependencies !== "object" ||
      Array.isArray(dependencies)
    ) {
      continue;
    }
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === "string" && version.startsWith("workspace:")) {
        workspaceDependencies.push(name);
      }
    }
  }
  if (workspaceDependencies.length === 0) return;
  throw new CommandError(
    "workspace_dependencies_unresolved",
    `This upload root uses workspace dependencies but is not a workspace root: ${workspaceDependencies.join(", ")}.`,
    {
      dependencies: workspaceDependencies,
      nextSteps: [
        {
          description: "Deploy the monorepo root and select this package",
          command:
            "mcp-use deploy <monorepo-root> --no-github --root-dir <package-path>",
        },
        {
          description:
            "Use published dependency versions for a standalone upload",
          command:
            "Replace workspace:* versions in package.json, then run mcp-use deploy --no-github",
        },
      ],
    }
  );
}

function sanitizeRepositoryName(name: string): string {
  const result = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return result || "mcp-server";
}

async function promptYesNo(
  question: string,
  defaultValue: boolean
): Promise<boolean> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(
      `${question} ${defaultValue ? "[Y/n]" : "[y/N]"} `
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized === "") return defaultValue;
    return normalized === "y" || normalized === "yes";
  } finally {
    prompt.close();
  }
}

function deploymentNotCreated(serverId: string): CommandError {
  return new CommandError(
    "deployment_not_created",
    "Server was created but no deployment was started.",
    {
      serverId,
      nextSteps: [
        {
          description: "Inspect the server",
          command: `mcp-use servers get ${serverId}`,
        },
      ],
    }
  );
}

function finishDeployment(input: {
  sourceType: "github" | "managed";
  serverId: string;
  serverSlug?: string | null;
  deploymentId: string;
  label: string;
  values: DeployValues;
  json: boolean;
}): number {
  const webUrl = `${cloudWebUrl()}/${encodeURIComponent(input.serverSlug ?? input.serverId)}`;
  const result = {
    sourceType: input.sourceType,
    serverId: input.serverId,
    deploymentId: input.deploymentId,
    status: "pending",
    webUrl,
  };
  if (input.values.open === true) openBrowser(webUrl);
  printResult(
    result,
    input.json,
    `Deployment ${input.deploymentId} started for ${input.label}.`
  );
  return 0;
}
