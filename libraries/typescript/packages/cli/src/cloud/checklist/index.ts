import { setTimeout as delay } from "node:timers/promises";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { CommandError, UsageError } from "../../core/errors.js";
import { connectProject, PROJECT_OPTIONS } from "../project/resolve.js";
import { cloudWebUrl } from "../cloud-api.js";
import { checklistClient, checklistRun } from "./api.js";

const USAGE =
  "mcp-use checklist <run|list|get <run-id>|cancel <run-id>> [options]";
const HELP = `Usage: ${USAGE}

Options:
  --server <id-or-slug>  Server, or the linked project
  --org <id-or-slug>     Organization override
  --path <dir>          Linked project directory
  --branch <name>       Branch for run or list
  --no-wait             Return a new run immediately
  --limit <n>           List page size, 1-100 (default: 30)
  --skip <n>            List offset (default: 0)
  --json                Emit one JSON result or error
  -h, --help            Show this help`;

/** Run and inspect the server publishing checklist. */
export async function runChecklist(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  return runCommand(argv, async (output) => {
    const command = argv[0];
    if (!["run", "list", "get", "cancel"].includes(command ?? ""))
      throw new UsageError(`Usage: ${USAGE}`);
    const { values, positionals } = parseCommandArgs(argv.slice(1), {
      options: {
        ...PROJECT_OPTIONS,
        json: { type: "boolean" },
        ...(command === "run" || command === "list"
          ? { branch: { type: "string" as const } }
          : {}),
        ...(command === "run"
          ? { "no-wait": { type: "boolean" as const } }
          : {}),
        ...(command === "list"
          ? {
              limit: { type: "string" as const },
              skip: { type: "string" as const },
            }
          : {}),
      },
      positionals: command === "get" || command === "cancel" ? 1 : 0,
      usage: USAGE,
    });
    const limit = Number(values.limit ?? 30),
      skip = Number(values.skip ?? 0);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(skip) ||
      skip < 0
    )
      throw new UsageError(
        "Pass --limit between 1 and 100 and a non-negative --skip."
      );
    const { cloud, server } = await connectProject(values);
    const found = await cloud.call(
      cloud.client.GET("/api/v1/servers/{id}", {
        params: { path: { id: server } },
      })
    );
    const serverId = found.id;
    const api = checklistClient(cloud.apiKey, cloud.organization.id);
    const dashboardUrl = `${cloudWebUrl()}/cloud/${encodeURIComponent(cloud.organization.slug ?? cloud.organization.id)}/servers/${encodeURIComponent(serverId)}/publish`;
    const branch =
      typeof values.branch === "string" ? { branch: values.branch } : {};
    if (command === "list") {
      const page = await cloud.call(
        api.GET("/api/v1/server-audits/{serverId}/audits", {
          params: { path: { serverId }, query: { limit, skip, ...branch } },
        })
      );
      const items = page.items.map(checklistRun);
      output.result(
        {
          items,
          total: page.total,
          limit: page.limit,
          skip: page.skip,
          dashboardUrl,
        },
        items.map((run) => `${run.id}\t${run.status}`).join("\n") ||
          "No checklist runs."
      );
      return;
    }
    const get = async (auditId: string) =>
      checklistRun(
        await cloud.call(
          api.GET("/api/v1/server-audits/{serverId}/audits/{auditId}", {
            params: { path: { serverId, auditId } },
          })
        )
      );
    let run;
    if (command === "cancel")
      run = checklistRun(
        await cloud.call(
          api.POST("/api/v1/server-audits/{serverId}/audits/{auditId}/cancel", {
            params: { path: { serverId, auditId: positionals[0]! } },
          })
        )
      );
    else if (command === "get") run = await get(positionals[0]!);
    else {
      run = checklistRun(
        await cloud.call(
          api.POST("/api/v1/server-audits/{serverId}/audits", {
            params: { path: { serverId } },
            body: branch,
          })
        )
      );
      if (values["no-wait"] !== true) {
        const started = Date.now();
        while (["pending", "running"].includes(run.status)) {
          if (Date.now() - started > 30 * 60 * 1000)
            throw new CommandError(
              "checklist_timeout",
              `Checklist ${run.id} is still running.`,
              undefined,
              [
                {
                  description: "Inspect the checklist",
                  command: `mcp-use checklist get ${run.id} --server ${serverId} --json`,
                },
              ]
            );
          const configured = process.env["MCP_USE_POLL_INTERVAL_MS"];
          await delay(
            configured === undefined
              ? 2000
              : Math.max(0, Number(configured) || 0)
          );
          run = await get(run.id);
        }
      }
    }
    output.result({ ...run, dashboardUrl }, `${run.id}\t${run.status}`);
  });
}
