import { plain, table } from "../../core/format.js";
import { readFile } from "node:fs/promises";

import { parseCloudArgs, projectServer, stdinText } from "../options.js";
import { cloudHelp } from "../help.js";
import { runCommand } from "../../core/command.js";
import { CommandError, UsageError } from "../../core/errors.js";
import { confirm } from "../../core/prompt.js";

const COMMANDS = ["list", "set", "rm", "remove", "push"];
type Environment = "production" | "preview" | "development";
type Phase = "runtime" | "build" | "both";

/** Manage write-only Cloud environment values and their scopes. */
export async function runEnv(argv: readonly string[]): Promise<number> {
  const operation = argv[0];
  const help = cloudHelp("env", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    if (!COMMANDS.includes(operation ?? ""))
      throw new UsageError("Usage: mcp-use env <list|set|rm|push>");
    const { values, positionals } = parseCloudArgs(
      argv.slice(1),
      {
        environment: { type: "string" },
        branch: { type: "string" },
        phase: { type: "string" },
        sensitive: { type: "boolean" },
        yes: { type: "boolean" },
      },
      `mcp-use env ${operation} [options]`,
      operation === "list" ? 0 : 1,
      operation === "set"
        ? Number.MAX_SAFE_INTEGER
        : operation === "list"
          ? 0
          : 1
    );
    const environment =
      values.environment ?? (values.branch ? "preview" : "production");
    if (!["production", "preview", "development"].includes(environment))
      throw new UsageError(
        "--environment must be production, preview or development."
      );
    if (values.branch && environment !== "preview")
      throw new UsageError("--branch requires --environment preview.");
    if (values.phase && !["runtime", "build", "both"].includes(values.phase))
      throw new UsageError("--phase must be runtime, build or both.");
    if (values.sensitive && operation !== "set")
      throw new UsageError(
        "--sensitive is available on env set; pipe one value through stdin."
      );
    const assignments =
      operation === "set"
        ? values.sensitive
          ? [sensitiveAssignment(positionals, await stdinText())]
          : positionals.map(assignment)
        : operation === "push"
          ? parseEnvFile(await readFile(positionals[0]!, "utf8"))
          : [];
    if (operation === "push" && assignments.length === 0)
      throw new UsageError("The environment file contains no assignments.");
    if (
      (operation === "rm" || operation === "remove") &&
      !(await confirm(`Remove environment variable ${positionals[0]}?`, {
        yes: values.yes === true,
        json: output.json,
      }))
    ) {
      output.result({ cancelled: true }, "Cancelled.");
      return;
    }
    const { cloud, server } = await projectServer(values);
    const query = values.branch ? { branch: values.branch } : {};
    const variables = await cloud.call(
      cloud.client.GET("/api/v1/servers/{id}/env-variables", {
        params: { path: { id: server }, query },
      })
    );
    const scoped = variables.filter(
      (item) =>
        (item.branch ?? null) === (values.branch ?? null) &&
        item.environments.includes(environment)
    );
    if (operation === "list") {
      const safe = scoped.map(metadata);
      output.result(
        safe,
        safe.length
          ? table(
              ["NAME", "ENVIRONMENTS", "PHASE", "VALUE"],
              safe.map((item) => [
                item.key,
                item.environments.join(", "),
                item.phase,
                item.sensitive ? "Sensitive" : "Plain",
              ])
            )
          : "No environment variables in this scope.\nSet one: mcp-use env set NAME=value"
      );
      return;
    }
    if (operation === "rm" || operation === "remove") {
      const existing = scoped.find((item) => item.key === positionals[0]);
      if (!existing)
        throw new CommandError(
          "environment_variable_not_found",
          `Environment variable ${positionals[0]} was not found in this scope.`
        );
      const otherEnvironments = existing.environments.filter(
        (item) => item !== environment
      ) as Environment[];
      if (otherEnvironments.length)
        await cloud.call(
          cloud.client.PATCH("/api/v1/servers/{id}/env-variables/{varId}", {
            params: { path: { id: server, varId: existing.id } },
            body: { environments: otherEnvironments },
          })
        );
      else
        await cloud.call(
          cloud.client.DELETE("/api/v1/servers/{id}/env-variables/{varId}", {
            params: { path: { id: server, varId: existing.id } },
          })
        );
      output.result(
        { removed: existing.key, environment, branch: values.branch ?? null },
        `✓ Removed ${plain(existing.key)} from ${plain(environment)}.`
      );
      return;
    }
    for (const { key } of assignments) {
      const existing = scoped.find((item) => item.key === key);
      if (
        existing &&
        existing.environments.some((item) => item !== environment)
      )
        throw new UsageError(
          `${key} is shared across environments. Split its environment scopes in the dashboard before changing one environment's value.`
        );
    }
    const results = [];
    try {
      for (const { key, value } of assignments) {
        const existing = scoped.find((item) => item.key === key);
        const body = {
          value,
          environments: [environment as Environment],
          phase: (values.phase ?? existing?.phase ?? "both") as Phase,
          sensitive: values.sensitive === true || existing?.sensitive === true,
          branch: values.branch ?? null,
        };
        const result = existing
          ? await cloud.call(
              cloud.client.PATCH("/api/v1/servers/{id}/env-variables/{varId}", {
                params: { path: { id: server, varId: existing.id } },
                body,
              })
            )
          : await cloud.call(
              cloud.client.POST("/api/v1/servers/{id}/env-variables", {
                params: { path: { id: server } },
                body: { ...body, key },
              })
            );
        results.push(metadata(result));
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      let message = error.message;
      for (const { value } of assignments)
        if (value) message = message.replaceAll(value, "[REDACTED]");
      throw new CommandError(
        error instanceof CommandError ? error.code : "cloud_api_error",
        message,
        undefined,
        error instanceof CommandError ? error.nextSteps : []
      );
    }
    output.result(
      { serverId: server, variables: results },
      results.map((item) => `✓ Set ${plain(item.key)}.`).join("\n")
    );
  });
}

function assignment(input: string): { key: string; value: string } {
  const separator = input.indexOf("=");
  if (
    separator < 1 ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.slice(0, separator))
  )
    throw new UsageError("Environment assignments must use KEY=VALUE.");
  return { key: input.slice(0, separator), value: input.slice(separator + 1) };
}

function sensitiveAssignment(positionals: string[], value: string) {
  if (
    positionals.length !== 1 ||
    !/^[A-Za-z_][A-Za-z0-9_]*=?$/.test(positionals[0]!)
  )
    throw new UsageError(
      "Pass one KEY with --sensitive, and pipe its value through stdin."
    );
  return {
    key: positionals[0]!.replace(/=$/, ""),
    value: value.replace(/\r?\n$/, ""),
  };
}

/** Parse ordinary dotenv assignments; values remain inside the process. */
export function parseEnvFile(source: string): { key: string; value: string }[] {
  return source.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const item = assignment(trimmed.replace(/^export\s+/, ""));
    if (
      (item.value.startsWith('"') && item.value.endsWith('"')) ||
      (item.value.startsWith("'") && item.value.endsWith("'"))
    )
      item.value = item.value.slice(1, -1);
    else item.value = item.value.replace(/\s+#.*$/, "").trimEnd();
    return [item];
  });
}

type Metadata = {
  id: string;
  serverId: string;
  key: string;
  environments: string[];
  phase: string;
  sensitive: boolean;
  branch: string | null;
  createdAt: string;
  updatedAt: string;
};
function metadata(item: Metadata): Metadata {
  return {
    id: item.id,
    serverId: item.serverId,
    key: item.key,
    environments: item.environments,
    phase: item.phase,
    sensitive: item.sensitive,
    branch: item.branch,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
