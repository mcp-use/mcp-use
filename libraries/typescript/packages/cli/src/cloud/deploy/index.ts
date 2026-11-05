import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { connectCloud } from "../api/client.js";
import { cloudWebUrl } from "../cloud-api.js";
import { readProjectLink } from "../project/link-file.js";
import { runCommand } from "../../core/command.js";
import { CommandError, UsageError } from "../../core/errors.js";
import { openBrowser } from "../../core/open-browser.js";
import { loadEnvironment } from "./env.js";
import { deployGitHub } from "./github.js";
import { deployUpload } from "./upload.js";
import {
  deployExternal,
  validateExternalOptions,
  validateExternalServer,
} from "./external-url.js";
import { waitForDeployment } from "./wait.js";
import type { DeployValues, DeployInput } from "./types.js";

const HELP = `Usage: mcp-use deploy [path] [options]

Deploy any MCP project to Manufact Cloud, or register an existing MCP endpoint.
Waits until the deployment is running by default. Use --no-wait to return its ID.

Sources:
  GitHub (default)       Deploy the current origin and branch
  --no-github            Upload local source without requiring Git or a framework
  --external-url <url>   Register an existing HTTPS MCP endpoint; verifies MCP first

Options:
  --org <id-or-slug>     Organization override
  --server <id-or-slug>  Server override (otherwise MANUFACT_SERVER, then the link)
  --new                 Create a new server instead of using the project link
  --name <name>         Server name (otherwise the project directory/package name)
  --branch <name>       Branch to deploy; leaves the saved production branch intact
  --root-dir <path>     Project root inside the repository or upload
  --env <KEY=VALUE>     Repeatable; production for the production branch, preview otherwise
  --env-file <path>     Load KEY=VALUE assignments, overridden by --env
  --build-command <cmd> Build command
  --start-command <cmd> Start command
  --dockerfile <path>   Dockerfile relative to the selected source root
  --region <region>     AUTO, US, EU, APAC, or GLOBAL
  --watch-paths <glob>  Repeatable GitHub auto-deploy filter
  --wait-for-ci         Wait for other GitHub checks before auto-deploy
  --no-wait             Return the deployment ID immediately
  --open                Open the dashboard in a terminal after deployment
  -y, --yes             Authorize Git repository creation, commits, and pushes
  --json                Emit one JSON result or error; never prompt
  -h, --help            Show help without auth or network access

External URLs support --org, --name, --new, --open and --json. They cannot be
combined with source, build, or environment options. Local state is stored in
.manufact/project.json. Uploads omit local credentials, .env files, dependencies,
build output, caches, and symbolic links.

Exit codes: 0 success; 1 operation failed; 2 invalid or missing arguments.`;

function parse(argv: readonly string[]): { values: DeployValues; cwd: string } {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: true,
      options: {
        org: { type: "string" },
        server: { type: "string" },
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
        "external-url": { type: "string" },
        "no-wait": { type: "boolean" },
        new: { type: "boolean" },
        open: { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error)
    );
  }
  if (parsed.positionals.length > 1)
    throw new UsageError("Usage: mcp-use deploy [path] [options]");
  for (const [flag, value] of Object.entries(parsed.values)) {
    if (typeof value === "string" && value.trim() === "")
      throw new UsageError(`--${flag} must not be empty.`);
  }
  if (
    parsed.values.region !== undefined &&
    !["AUTO", "US", "EU", "APAC", "GLOBAL"].includes(
      parsed.values.region.toUpperCase()
    )
  )
    throw new UsageError("--region must be AUTO, US, EU, APAC, or GLOBAL.");
  if (parsed.values.open && (parsed.values.json || !process.stdin.isTTY))
    throw new UsageError(
      "--open requires an interactive terminal without --json.",
      { code: "invalid_argument_combination" }
    );
  if (parsed.values.new && parsed.values.server)
    throw new UsageError("Pass --new or --server, not both.", {
      code: "invalid_argument_combination",
    });
  validateExternalOptions(parsed.values);
  return {
    values: parsed.values,
    cwd: resolve(parsed.positionals[0] ?? process.cwd()),
  };
}

/** Run deployment under the same agent-facing conventions as other commands. */
export async function runDeploy(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  return runCommand(argv, HELP, async (output) => {
    const { values, cwd } = parse(argv);
    const env = await loadEnvironment(
      cwd,
      values["env-file"],
      values.env ?? []
    );
    if (values["external-url"] !== undefined)
      await validateExternalServer(values["external-url"]);
    const link = values.new ? null : await readProjectLink(cwd);
    const cloud = await connectCloud({
      organization: values.org ?? process.env["MANUFACT_ORG"] ?? link?.orgId,
    });
    // A server may echo a rejected value; deployment secrets stay out of errors.
    const call = cloud.call;
    cloud.call = async (pending, context) => {
      try {
        return await call(pending, context);
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        let message = error.message;
        for (const value of Object.values(env))
          if (value !== "") message = message.replaceAll(value, "[REDACTED]");
        throw new CommandError(error.code, message, undefined, error.nextSteps);
      }
    };
    const selector = values.new
      ? undefined
      : (values.server ?? process.env["MANUFACT_SERVER"] ?? link?.serverId);
    const linkedServer =
      selector === undefined
        ? undefined
        : await cloud.call(
            cloud.client.GET("/api/v1/servers/{id}", {
              params: { path: { id: selector } },
            }),
            { notFound: { code: "server_not_found" } }
          );
    const input: DeployInput = {
      cloud,
      cwd,
      existing: linkedServer
        ? { orgId: cloud.organization.id, serverId: linkedServer.id }
        : null,
      values,
      env,
      ...(linkedServer !== undefined ? { linkedServer } : {}),
    };
    const dashboard = (id: string) =>
      cloud.organization.slug
        ? `${cloudWebUrl()}/cloud/${encodeURIComponent(cloud.organization.slug)}/servers/${encodeURIComponent(id)}/overview`
        : null;
    if (values["external-url"] !== undefined) {
      const result = await deployExternal(input);
      const dashboardUrl = dashboard(result.serverId);
      if (values.open && dashboardUrl) openBrowser(dashboardUrl);
      output.result(
        { ...result, dashboardUrl },
        `Registered ${result.externalUrl}${dashboardUrl ? `\n${dashboardUrl}` : ""}`
      );
      return;
    }
    if (linkedServer?.isExternal)
      throw new UsageError(
        "The link points to an external server. Pass --external-url to update it, or --new to deploy a separate server.",
        { code: "source_mode_conflict" }
      );
    const managed =
      values["no-github"] || linkedServer?.connectedRepository?.isManaged;
    if (
      values["no-github"] &&
      linkedServer &&
      !linkedServer.connectedRepository?.isManaged
    )
      throw new UsageError(
        "A local upload cannot replace a linked GitHub source. Pass --new to create a separate server.",
        { code: "source_mode_conflict" }
      );
    if (
      managed &&
      (values["watch-paths"] !== undefined || values["wait-for-ci"])
    )
      throw new UsageError(
        "--watch-paths and --wait-for-ci require GitHub deployments.",
        { code: "source_mode_conflict" }
      );
    const started = managed
      ? await deployUpload(input)
      : await deployGitHub(input);
    const terminal = values["no-wait"]
      ? { status: "pending" }
      : await waitForDeployment(cloud, started.deploymentId);
    const dashboardUrl = dashboard(started.serverId);
    if (values.open && dashboardUrl) openBrowser(dashboardUrl);
    output.result(
      { ...started, ...terminal, dashboardUrl },
      `Deployment ${started.deploymentId} ${terminal.status}.${dashboardUrl ? `\n${dashboardUrl}` : ""}`
    );
  });
}
