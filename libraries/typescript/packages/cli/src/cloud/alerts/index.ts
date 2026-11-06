import { cloudHelp } from "../help.js";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";
import { confirm } from "../../core/prompt.js";
import { cloudWebUrl } from "../cloud-api.js";
import type { operations } from "../api/generated/types.gen.js";
import { connectProject, PROJECT_OPTIONS } from "../project/resolve.js";
import { plain, fields } from "../../core/format.js";
import { formatAlert, formatAlertList } from "./output.js";
import { readAlertFile } from "./config.js";

const USAGE =
  "mcp-use alerts <list|get <id>|create|update <id>|rm <id>|options> [options]";

type Rule =
  operations["getApiV1ServersByIdAlertsRulesByRuleId"]["responses"][200]["content"]["application/json"]["rule"];
/** Select public fields before printing a rule returned by Cloud. */
function publicRule(rule: Rule) {
  const config = rule.config;
  return {
    id: rule.id,
    revision: rule.revision,
    config: {
      name: config.name,
      ...(config.description === undefined
        ? {}
        : { description: config.description }),
      enabled: config.enabled,
      trigger: config.trigger,
      recover: config.recover,
      notify: config.notify,
    },
  };
}

/** Manage alert rules using dashboard-compatible YAML. */
export async function runAlerts(argv: readonly string[]): Promise<number> {
  const help = cloudHelp("alerts", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    const command = argv[0] === "remove" ? "rm" : argv[0];
    if (
      !["list", "get", "create", "update", "rm", "options"].includes(
        command ?? ""
      )
    )
      throw new UsageError(`Usage: ${USAGE}`);
    const writing = command === "create" || command === "update";
    const { values, positionals } = parseCommandArgs(argv.slice(1), {
      options: {
        ...PROJECT_OPTIONS,
        json: { type: "boolean" },
        ...(writing
          ? {
              file: { type: "string" as const },
              reason: { type: "string" as const },
            }
          : {}),
        ...(command === "rm" ? { yes: { type: "boolean" as const } } : {}),
        ...(command === "list"
          ? {
              limit: { type: "string" as const },
              skip: { type: "string" as const },
            }
          : {}),
      },
      positionals: ["get", "update", "rm"].includes(command!) ? 1 : 0,
      usage: USAGE,
    });
    if (writing && typeof values.file !== "string")
      throw new UsageError("Pass --file <rule.yaml>.");
    const config = writing
      ? await readAlertFile(values.file as string)
      : undefined;
    const reason =
      typeof values.reason === "string"
        ? values.reason.trim()
        : "Updated using the CLI";
    if (writing && (reason.length === 0 || reason.length > 500))
      throw new UsageError("Pass --reason as 1 to 500 characters.");
    const limit = Number(values.limit ?? 25),
      offset = Number(values.skip ?? 0);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new UsageError(
        "Pass --limit between 1 and 100 and a non-negative --skip."
      );
    if (
      command === "rm" &&
      !(await confirm("Remove this alert rule?", {
        yes: values.yes === true,
        json: output.json,
      }))
    )
      return;
    const { cloud, server } = await connectProject(values);
    const found = await cloud.call(
      cloud.client.GET("/api/v1/servers/{id}", {
        params: { path: { id: server } },
      })
    );
    const id = found.id,
      ruleId = positionals[0]!;
    const dashboardUrl = `${cloudWebUrl()}/cloud/${encodeURIComponent(cloud.organization.slug ?? cloud.organization.id)}/servers/${encodeURIComponent(id)}/alerts`;
    if (command === "options") {
      const result = await cloud.call(
        cloud.client.GET("/api/v1/servers/{id}/alerts/options", {
          params: { path: { id } },
        })
      );
      output.result(
        { ...result, dashboardUrl },
        result.metrics
          .map((metric) => `${metric.name}\t${metric.description}`)
          .join("\n")
      );
    } else if (command === "list") {
      const result = await cloud.call(
        cloud.client.GET("/api/v1/servers/{id}/alerts/rules", {
          params: { path: { id }, query: { limit, offset } },
        })
      );
      const rules = result.rules.map((rule) => ({
        ...publicRule(rule),
        status: rule.status,
      }));
      output.result(
        { total: result.total, rules, dashboardUrl },
        formatAlertList(
          result.rules,
          result.total,
          found.name ?? found.slug ?? id
        )
      );
    } else if (command === "create") {
      const result = await cloud.call(
        cloud.client.POST("/api/v1/servers/{id}/alerts/rules", {
          params: { path: { id } },
          body: {
            config: {
              ...config!,
              enabled: config!.enabled ?? true,
              audience: "customer",
              targets: { serverIds: [id] },
            },
            reason,
          },
        })
      );
      output.result(
        { rule: publicRule(result.rule), dashboardUrl },
        `✓ Created alert “${plain(result.rule.config.name)}”\n${fields([["ID", result.rule.id]])}`
      );
    } else {
      const current = await cloud.call(
        cloud.client.GET("/api/v1/servers/{id}/alerts/rules/{ruleId}", {
          params: { path: { id, ruleId } },
        })
      );
      if (command === "get")
        output.result(
          { rule: publicRule(current.rule), dashboardUrl },
          formatAlert(
            current.rule,
            found.name ?? found.slug ?? id,
            dashboardUrl
          )
        );
      else if (command === "rm") {
        const result = await cloud.call(
          cloud.client.DELETE("/api/v1/servers/{id}/alerts/rules/{ruleId}", {
            params: { path: { id, ruleId } },
            body: { expectedRevision: current.rule.revision },
          })
        );
        output.result(
          { ...result, dashboardUrl },
          `✓ Removed alert “${plain(current.rule.config.name)}”\n${fields([["ID", ruleId]])}`
        );
      } else {
        const result = await cloud.call(
          cloud.client.PUT("/api/v1/servers/{id}/alerts/rules/{ruleId}", {
            params: { path: { id, ruleId } },
            body: {
              config: {
                ...config!,
                id: ruleId,
                enabled: config!.enabled ?? current.rule.config.enabled,
                audience: "customer",
                targets: { serverIds: [id] },
              },
              expectedRevision: current.rule.revision,
              reason,
            },
          })
        );
        output.result(
          { rule: publicRule(result.rule), dashboardUrl },
          `✓ Updated alert “${plain(result.rule.config.name)}”\n${fields([
            ["Rule", result.rule.config.enabled ? "Enabled" : "Paused"],
            ["ID", ruleId],
          ])}`
        );
      }
    }
  });
}
