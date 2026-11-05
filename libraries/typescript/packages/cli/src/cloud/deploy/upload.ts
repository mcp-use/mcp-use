import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { cloudApiUrl } from "../cloud-api.js";
import { writeProjectLink } from "../project/link-file.js";
import type { operations } from "../api/generated/types.gen.js";
import { pathExists } from "../../core/fs.js";
import { UsageError, CommandError } from "../../core/errors.js";
import {
  packProject,
  appendArchive,
  assertManagedArchiveSize,
} from "./archive.js";
import {
  resolveContainedPath,
  validateSourcePath,
  syncEnvironment,
} from "./env.js";
import { syncServerConfiguration } from "./config.js";
import { serverCreationTimeout, deploymentStartTimeout } from "./errors.js";
import type { Cloud, DeployInput, StartedDeployment } from "./types.js";

type CreatedServer =
  operations["postApiV1Servers"]["responses"][201]["content"]["application/json"];
type SourceUpdate =
  operations["postApiV1ServersByIdSource"]["responses"][200]["content"]["application/json"];

/** Multipart bodies are absent from the API document; use its response types. */
async function upload<T>(
  cloud: Cloud,
  path: string,
  form: FormData,
  context: Parameters<Cloud["call"]>[1]
): Promise<T> {
  return cloud.call(
    fetch(`${cloudApiUrl()}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "x-api-key": cloud.apiKey,
        "x-profile-id": cloud.organization.id,
      },
      body: form,
      signal: AbortSignal.timeout(120_000),
    }).then(async (response) => {
      const text = await response.text();
      let body: unknown;
      try {
        body = text === "" ? undefined : JSON.parse(text);
      } catch {
        body = text;
      }
      return response.ok
        ? { data: body as T, response }
        : { error: body, response };
    }),
    context
  );
}

/** Upload a project from any language or framework to managed hosting. */
export async function deployUpload(
  input: DeployInput
): Promise<StartedDeployment> {
  const { cloud, cwd, existing, values, env } = input;
  const sourceRoot = resolveContainedPath(
    cwd,
    values["root-dir"] ?? ".",
    "--root-dir"
  );
  if (!(await pathExists(sourceRoot)))
    throw new UsageError(`Project directory not found: ${sourceRoot}`);
  validateSourcePath(sourceRoot, values.dockerfile, "--dockerfile");
  if (!values.json) process.stderr.write("Deploying...\n");
  const archive = await packProject(cwd);
  assertManagedArchiveSize(archive.byteLength);
  const branch =
    values.branch ??
    input.linkedServer?.connectedRepository?.productionBranch ??
    "main";
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
    const form = new FormData();
    appendArchive(form, archive);
    form.set("branch", branch);
    form.set("commitMessage", "Redeploy from CLI");
    await upload<SourceUpdate>(
      cloud,
      `/servers/${encodeURIComponent(serverId)}/source`,
      form,
      {
        timeout: {
          message:
            "Cloud timed out while uploading source. The upload may still be processing. Check the server before running deploy again.",
          nextSteps: [
            {
              description: "Inspect the server",
              command: `mcp-use servers get ${serverId} --json`,
            },
          ],
        },
      }
    );
    const deployment = await cloud.call(
      cloud.client.POST("/api/v1/deployments", {
        body: { serverId, branch, trigger: "redeploy" },
      }),
      deploymentStartTimeout(serverId)
    );
    deploymentId = deployment.id;
  } else {
    const name = values.name ?? (await projectName(sourceRoot));
    const form = new FormData();
    appendArchive(form, archive);
    for (const [key, value] of Object.entries({
      organizationId: cloud.organization.id,
      managed: "true",
      name,
      repoName: name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80),
      private: "true",
      branch,
      commitMessage: "Deploy from CLI",
    }))
      form.set(key, value);
    for (const [flag, field] of [
      ["region", "region"],
      ["root-dir", "rootDir"],
      ["build-command", "buildCommand"],
      ["start-command", "startCommand"],
      ["dockerfile", "dockerfilePath"],
    ] as const) {
      const value = values[flag];
      if (value !== undefined) form.set(field, value);
    }
    if (Object.keys(env).length) form.set("env", JSON.stringify(env));
    const created = await upload<CreatedServer>(
      cloud,
      "/servers",
      form,
      serverCreationTimeout()
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
  return { sourceType: "managed", serverId, deploymentId };
}

/** Infer a friendly name without requiring a Node project. */
export async function projectName(cwd: string): Promise<string> {
  try {
    const value: unknown = JSON.parse(
      await readFile(`${cwd}/package.json`, "utf8")
    );
    if (
      value !== null &&
      typeof value === "object" &&
      "name" in value &&
      typeof value.name === "string" &&
      value.name.trim()
    )
      return value.name;
  } catch {
    /* Any language is supported; the directory name is the fallback. */
  }
  return basename(cwd);
}
