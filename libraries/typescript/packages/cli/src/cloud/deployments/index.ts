import { cloudFor, human, integer, parseCloudArgs } from "../options.js";
import { runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";
import { confirm } from "../../core/prompt.js";
import { formatDeployment, formatDeploymentList } from "./output.js";

const COMMANDS = ["list", "get", "restart", "promote", "stop", "rm", "remove"];

/** Manage deployment history, traffic and lifecycle. */
export async function runDeployments(argv: readonly string[]): Promise<number> {
  const operation = argv[0];
  if (argv.includes("--help") || argv.includes("-h")) {
    const sub = COMMANDS.includes(operation ?? "") ? ` ${operation}` : "";
    process.stdout.write(
      `Usage: mcp-use deployments${sub} [options]\n\nCommands: list, get <id>, restart <id>, promote <id>, stop <id>, rm <id> (alias: remove)\n\nOptions:\n  --org <id-or-slug>  Organization override\n  --server <id>       Filter list by server\n  --limit <n>         Results per page (default 30, maximum 200)\n  --skip <n>          Pagination offset\n  --branch <name>     Restart branch override\n  --yes              Confirm promote, stop or removal\n  --json             Emit one result or error\n`
    );
    return 0;
  }
  return runCommand(argv, async (output) => {
    if (!COMMANDS.includes(operation ?? ""))
      throw new UsageError(
        "Usage: mcp-use deployments <list|get|restart|promote|stop|rm>"
      );
    const { values, positionals } = parseCloudArgs(
      argv.slice(1),
      {
        limit: { type: "string" },
        skip: { type: "string" },
        branch: { type: "string" },
        yes: { type: "boolean" },
      },
      `mcp-use deployments ${operation} ${operation === "list" ? "" : "<id>"} [options]`,
      operation === "list" ? 0 : 1
    );
    const limit = integer(values.limit, "--limit", 30, 1, 200);
    const skip = integer(values.skip, "--skip", 0);
    if (
      ["promote", "stop", "rm", "remove"].includes(operation!) &&
      !(await confirm(`${operation} deployment ${positionals[0]}?`, {
        yes: values.yes === true,
        json: output.json,
      }))
    ) {
      output.result({ cancelled: true }, "Cancelled.");
      return;
    }
    const cloud = await cloudFor(values);
    if (operation === "list") {
      const serverId = values.server ?? process.env["MANUFACT_SERVER"];
      const page = await cloud.call(
        cloud.client.GET("/api/v1/deployments", {
          params: {
            query: {
              organizationId: cloud.organization.id,
              limit,
              skip,
              ...(serverId ? { serverId } : {}),
            },
          },
        })
      );
      output.result(page, formatDeploymentList(page));
      return;
    }
    const id = positionals[0]!;
    const params = { path: { id } };
    const context = {
      notFound: {
        code: "deployment_not_found",
        nextSteps: [
          {
            description: "List deployments",
            command: "mcp-use deployments list --json",
          },
        ],
      },
    };
    if (operation === "get") {
      const deployment = await cloud.call(
        cloud.client.GET("/api/v1/deployments/{id}", { params }),
        context
      );
      output.result(deployment, formatDeployment(deployment));
      return;
    }
    if (operation === "restart") {
      const previous = await cloud.call(
        cloud.client.GET("/api/v1/deployments/{id}", { params }),
        context
      );
      if (!previous.serverId)
        throw new UsageError("This deployment is not attached to a server.");
      const branch = values.branch ?? previous.gitBranch;
      const result = await cloud.call(
        cloud.client.POST("/api/v1/deployments", {
          body: {
            serverId: previous.serverId,
            trigger: "redeploy",
            ...(branch ? { branch } : {}),
          },
        })
      );
      output.result(result, `Created deployment ${result.id}.`);
      return;
    }
    const result =
      operation === "promote"
        ? await cloud.call(
            cloud.client.POST("/api/v1/deployments/{id}/activate", { params }),
            context
          )
        : operation === "stop"
          ? await cloud.call(
              cloud.client.POST("/api/v1/deployments/{id}/stop", { params }),
              context
            )
          : await cloud.call(
              cloud.client.DELETE("/api/v1/deployments/{id}", { params }),
              context
            );
    output.result(result, human(result));
  });
}
