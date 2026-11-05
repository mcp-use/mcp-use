import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { CommandError, UsageError } from "../../core/errors.js";
import { writeProjectLink } from "../project/link-file.js";
import type { operations } from "../api/generated/types.gen.js";
import {
  authorizeRepositoryBootstrap,
  bootstrapRepository,
  handleDirtyRepository,
  parseGitHubRepository,
  probeGit,
  sanitizeRepositoryName,
} from "./git.js";
import { validateSourcePath, syncEnvironment } from "./env.js";
import { syncServerConfiguration, region } from "./config.js";
import { projectName } from "./upload.js";
import type {
  Cloud,
  DeployInput,
  DeployValues,
  StartedDeployment,
} from "./types.js";

type Installation =
  operations["getApiV1GithubInstallations"]["responses"][200]["content"]["application/json"]["installations"][number];

async function installations(cloud: Cloud): Promise<Installation[]> {
  const result = await cloud.call(
    cloud.client.GET("/api/v1/github/installations", {
      params: { query: { organizationId: cloud.organization.id } },
    })
  );
  if (result.installations.length === 0)
    throw new CommandError(
      "github_installation_required",
      "Connect a GitHub installation before deploying from GitHub.",
      undefined,
      [
        {
          description: "Connect GitHub",
          command: "mcp-use github connect --json",
        },
        {
          description: "Upload local source",
          command: "mcp-use deploy --no-github",
        },
      ]
    );
  return result.installations;
}

async function chooseInstallation(
  items: Installation[],
  values: DeployValues
): Promise<Installation> {
  const ordered = [...items].sort(
    (a, b) =>
      Number(b.account?.type.toLowerCase() === "organization") -
      Number(a.account?.type.toLowerCase() === "organization")
  );
  if (ordered.length === 1 || values.yes) return ordered[0]!;
  if (values.json || !process.stdin.isTTY)
    throw new UsageError(
      "Multiple GitHub installations are available. Pass --yes to use the default installation."
    );
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    ordered.forEach((item, index) =>
      process.stderr.write(
        `${index + 1}. ${item.account?.login ?? item.installationId}\n`
      )
    );
    const answer = await prompt.question("GitHub account [1]: ");
    const selected = ordered[(answer.trim() === "" ? 1 : Number(answer)) - 1];
    if (!selected) throw new UsageError("Invalid GitHub account selection.");
    return selected;
  } finally {
    prompt.close();
  }
}

/** Create or redeploy a GitHub-backed server. */
export async function deployGitHub(
  input: DeployInput
): Promise<StartedDeployment> {
  const { cloud, cwd, existing, values, env } = input;
  let probe = await probeGit(cwd);
  let repository: string;
  let installation: Installation | undefined;
  if (!probe.remote) {
    if (probe.unavailable)
      throw new CommandError(
        "git_unavailable",
        "Git is unavailable. Use --no-github to upload local source."
      );
    await authorizeRepositoryBootstrap(values, values.json === true);
    installation = await chooseInstallation(await installations(cloud), values);
    const created = await cloud.call(
      cloud.client.POST("/api/v1/github/installations/{installationId}/repos", {
        params: { path: { installationId: installation.installationId } },
        body: {
          name: sanitizeRepositoryName(values.name ?? (await projectName(cwd))),
          private: true,
          ...(installation.account?.login
            ? { org: installation.account.login }
            : {}),
        },
      })
    );
    await bootstrapRepository(cwd, probe, created.cloneUrl);
    probe = await probeGit(cwd);
    repository = created.fullName;
  } else repository = parseGitHubRepository(probe.remote);
  const branch = values.branch ?? probe.branch;
  if (!branch || branch === "HEAD")
    throw new UsageError(
      "Cannot infer a branch from detached HEAD. Pass --branch <name>.",
      { code: "branch_required" }
    );
  const root = probe.root ?? cwd;
  validateSourcePath(root, values["root-dir"], "--root-dir");
  validateSourcePath(root, values.dockerfile, "--dockerfile");
  if (probe.dirty)
    await handleDirtyRepository(root, branch, values, values.json === true);
  let serverId: string;
  let deploymentId: string;
  if (existing !== null) {
    serverId = existing.serverId;
    await syncServerConfiguration(cloud, serverId, values);
    await syncEnvironment(
      cloud,
      serverId,
      env,
      branch,
      input.linkedServer?.connectedRepository?.productionBranch ?? "main"
    );
    const deployed = await cloud.call(
      cloud.client.POST("/api/v1/deployments", {
        body: { serverId, branch, trigger: "manual" },
      })
    );
    deploymentId = deployed.id;
  } else {
    if (!installation) {
      const [owner, repo] = repository.split("/") as [string, string];
      for (const candidate of await installations(cloud)) {
        const access = await cloud.call(
          cloud.client.GET(
            "/api/v1/github/installations/{installationId}/repos/{owner}/{repo}/access",
            {
              params: {
                path: { installationId: candidate.installationId, owner, repo },
              },
            }
          )
        );
        if (access.hasAccess) {
          installation = candidate;
          break;
        }
      }
    }
    if (!installation)
      throw new CommandError(
        "github_access_required",
        `No connected GitHub installation can access ${repository}.`,
        undefined,
        [
          {
            description: "Connect GitHub",
            command: "mcp-use github connect --json",
          },
        ]
      );
    const created = await cloud.call(
      cloud.client.POST("/api/v1/servers", {
        body: {
          type: "github",
          organizationId: cloud.organization.id,
          installationId: installation.id,
          name: values.name ?? basename(repository),
          repoFullName: repository,
          branch,
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
          ...(values.region !== undefined
            ? { region: region(values.region) }
            : {}),
          ...(values["watch-paths"] !== undefined
            ? { watchPaths: values["watch-paths"] }
            : {}),
          ...(values["wait-for-ci"] !== undefined
            ? { waitForCi: values["wait-for-ci"] }
            : {}),
          ...(Object.keys(env).length ? { env } : {}),
        },
      })
    );
    serverId = created.server.id;
    if (created.deploymentId === null)
      throw new CommandError(
        "deployment_not_created",
        "The server was created but no deployment was started."
      );
    deploymentId = created.deploymentId;
  }
  await writeProjectLink(cwd, { orgId: cloud.organization.id, serverId });
  return { sourceType: "github", serverId, deploymentId };
}
