import { age, elapsed, table } from "../../core/format.js";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { cloudHelp } from "../help.js";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { CommandError, UsageError } from "../../core/errors.js";
import { connectProject, PROJECT_OPTIONS } from "../project/resolve.js";
import { cloudWebUrl } from "../cloud-api.js";
import { checklistClient, checklistRun, type ChecklistRun } from "./api.js";
import {
  checkStatus,
  formatChecklist,
  formatChecklistMarkdown,
} from "./output.js";
import { withProgress } from "../../core/progress.js";

const FAIL_ON = ["none", "failed", "warnings"] as const;

/** Whether `value` is an absolute http(s) URL, the only kind Cloud accepts for `--url`. */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Whether a finished run should fail the command under `--fail-on`. */
function shouldFail(
  run: ChecklistRun,
  failOn: (typeof FAIL_ON)[number]
): boolean {
  if (failOn === "none") return false;
  if (run.status !== "completed") return true;
  const failing = failOn === "warnings" ? ["failed", "warnings"] : ["failed"];
  return (run.checks ?? []).some((check) =>
    failing.includes(checkStatus(check))
  );
}

/** Errors worth retrying while polling: the run keeps going on Cloud. */
const TRANSIENT = new Set([
  "cloud_unreachable",
  "cloud_timeout",
  "rate_limited",
  "cloud_api_error",
]);
/** Consecutive failed polls tolerated before giving up. */
const MAX_POLL_RETRIES = 6;
const MAX_BACKOFF_MS = 30_000;

/** Exponential backoff with full jitter: random in [0, min(cap, base * 2^n)]. */
function backoff(base: number, attempt: number): number {
  return Math.random() * Math.min(MAX_BACKOFF_MS, base * 2 ** attempt);
}

const USAGE =
  "mcp-use checklist <run|list|get <run-id>|cancel <run-id>> [options]";

/** Run and inspect the server publishing checklist. */
export async function runChecklist(argv: readonly string[]): Promise<number> {
  const help = cloudHelp("checklist", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  let failed = false;
  const code = await runCommand(argv, help, async (output) => {
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
        ...(command === "run" || command === "get"
          ? { "markdown-file": { type: "string" as const } }
          : {}),
        ...(command === "run"
          ? {
              "no-wait": { type: "boolean" as const },
              "fail-on": { type: "string" as const },
              "json-file": { type: "string" as const },
              url: { type: "string" as const },
              profile: { type: "string" as const },
            }
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
    const failOn = (values["fail-on"] ?? "none") as (typeof FAIL_ON)[number];
    if (!FAIL_ON.includes(failOn))
      throw new UsageError("Pass --fail-on as none, failed or warnings.");
    if (values["fail-on"] !== undefined && values["no-wait"] === true)
      throw new UsageError("--fail-on needs a finished run; drop --no-wait.");
    const targetUrl = typeof values.url === "string" ? values.url.trim() : "";
    const profileId =
      typeof values.profile === "string" ? values.profile.trim() : "";
    if (values.url !== undefined && !isHttpUrl(targetUrl))
      throw new UsageError("Pass --url as an http or https URL.");
    if (values.profile !== undefined && profileId === "")
      throw new UsageError("Pass --profile as a profile ID.");
    if ((targetUrl || profileId) && values.branch !== undefined)
      throw new UsageError(
        "External URL servers have no branches; drop --branch with --url or --profile."
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
              body: {
                ...branch,
                ...(targetUrl ? { url: targetUrl } : {}),
                ...(profileId ? { profileId } : {}),
              },
            })
          ),
          true
        );
        if (values["no-wait"] !== true) {
          const started = Date.now();
          const configured = process.env["MCP_USE_POLL_INTERVAL_MS"];
          const interval =
            configured === undefined
              ? 2000
              : Math.max(0, Number(configured) || 0);
          let failures = 0;
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
            await delay(failures ? backoff(interval, failures) : interval);
            try {
              run = await get(run.id);
              failures = 0;
            } catch (error) {
              // A failed status read doesn't affect the run; keep polling.
              if (
                !(error instanceof CommandError) ||
                !TRANSIENT.has(error.code) ||
                ++failures > MAX_POLL_RETRIES
              )
                throw error;
            }
          }
        }
      }
      // Judge the full run: the public result omits check severity.
      if (command === "run") failed = shouldFail(run, failOn);
      const serverName = found.name ?? found.slug ?? serverId;
      return {
        value: { ...checklistRun(run), dashboardUrl },
        markdown: formatChecklistMarkdown(run, { serverName, dashboardUrl }),
        human: formatChecklist(run, {
          verbose: values.verbose === true,
          serverName,
          dashboardUrl,
          color:
            process.stdout.isTTY === true &&
            process.env["TERM"] !== "dumb" &&
            process.env["NO_COLOR"] === undefined,
        }),
      };
    });
    // Lets CI read the result while the log keeps the readable report.
    if (typeof values["json-file"] === "string")
      await writeFile(values["json-file"], `${JSON.stringify(result.value)}\n`);
    // A dashboard-style report for pull request comments and job summaries.
    if (typeof values["markdown-file"] === "string") {
      if (values["markdown-file"] === values["json-file"])
        throw new UsageError(
          "--json-file and --markdown-file must use different paths."
        );
      if ("markdown" in result)
        await writeFile(values["markdown-file"], `${result.markdown}\n`);
    }
    output.result(result.value, result.human);
    if (failed)
      process.stderr.write(`Checklist did not pass (--fail-on ${failOn}).\n`);
  });
  return code === 0 && failed ? 1 : code;
}
