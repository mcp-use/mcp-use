import { age, elapsed, table } from "../../core/format.js";
import { setTimeout as delay } from "node:timers/promises";
import { cloudHelp } from "../help.js";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { CommandError, UsageError } from "../../core/errors.js";
import { connectProject, PROJECT_OPTIONS } from "../project/resolve.js";
import { cloudWebUrl } from "../cloud-api.js";
import { checklistClient, checklistRun } from "./api.js";
import { formatChecklist } from "./output.js";
import { withProgress } from "../../core/progress.js";

const USAGE =
  "mcp-use checklist <run|list|get <run-id>|cancel <run-id>> [options]";

/** Run and inspect the server publishing checklist. */
export async function runChecklist(argv: readonly string[]): Promise<number> {
  const help = cloudHelp("checklist", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    const command = argv[0];
    if (!["run", "list", "get", "cancel"].includes(command ?? ""))
      throw new UsageError(`Usage: ${USAGE}`);
    const { values, positionals } = parseCommandArgs(argv.slice(1), {
      options: {
        ...PROJECT_OPTIONS,
        json: { type: "boolean" },
        ...(command !== "list"
          ? { verbose: { type: "boolean" as const } }
          : {}),
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
    const label =
      command === "run"
        ? "Running checklist"
        : command === "cancel"
          ? "Cancelling checklist"
          : command === "list"
            ? "Loading checklist runs"
            : "Loading checklist";
    const result = await withProgress(label, output.json, async () => {
      const { cloud, server } = await connectProject(values);
      const found = await cloud.call(
        cloud.client.GET("/api/v1/servers/{id}", {
          params: { path: { id: server } },
        })
      );
      const serverId = found.id;
      const api = checklistClient(cloud.apiKey, cloud.organization.id);
      const dashboardUrl = `${cloudWebUrl()}/cloud/${encodeURIComponent(cloud.organization.slug ?? cloud.organization.id)}/servers/${encodeURIComponent(serverId)}/checklist`;
      const branch =
        typeof values.branch === "string" ? { branch: values.branch } : {};
      if (command === "list") {
        const page = await cloud.call(
          api.GET("/api/v1/server-audits/{serverId}/audits", {
            params: { path: { serverId }, query: { limit, skip, ...branch } },
          })
        );
        const items = page.items.map((item) => checklistRun(item));
        return {
          value: {
            items,
            total: page.total,
            limit: page.limit,
            skip: page.skip,
            dashboardUrl,
          },
          human: items.length
            ? `Checklist runs · ${found.name ?? found.slug ?? serverId}\n\n${table(
                ["STATUS", "BRANCH", "DURATION", "CREATED", "ID"],
                items.map((run) => [
                  run.status,
                  run.gitBranch,
                  elapsed(run.startedAt, run.completedAt),
                  age(run.createdAt),
                  run.id,
                ])
              )}\n\n${items.length} shown · ${page.total} total`
            : "No checklist runs on this page.\nStart one: mcp-use checklist run",
        };
      }
      const get = async (auditId: string) =>
        checklistRun(
          await cloud.call(
            api.GET("/api/v1/server-audits/{serverId}/audits/{auditId}", {
              params: { path: { serverId, auditId } },
            })
          ),
          true
        );
      let run;
      if (command === "cancel")
        run = checklistRun(
          await cloud.call(
            api.POST(
              "/api/v1/server-audits/{serverId}/audits/{auditId}/cancel",
              {
                params: { path: { serverId, auditId: positionals[0]! } },
              }
            )
          ),
          true
        );
      else if (command === "get") run = await get(positionals[0]!);
      else {
        run = checklistRun(
          await cloud.call(
            api.POST("/api/v1/server-audits/{serverId}/audits", {
              params: { path: { serverId } },
              body: branch,
            })
          ),
          true
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
      return {
        value: { ...checklistRun(run), dashboardUrl },
        human: formatChecklist(run, {
          verbose: values.verbose === true,
          serverName: found.name ?? found.slug ?? serverId,
          dashboardUrl,
          color:
            process.stdout.isTTY === true &&
            process.env["TERM"] !== "dumb" &&
            process.env["NO_COLOR"] === undefined,
        }),
      };
    });
    output.result(result.value, result.human);
  });
}
