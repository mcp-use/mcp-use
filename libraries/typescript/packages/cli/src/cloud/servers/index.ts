import {
  cloudFor,
  human,
  integer,
  parseCloudArgs,
  projectServer,
} from "../options.js";
import { cloudHelp } from "../help.js";
import { runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";
import { confirm } from "../../core/prompt.js";
import { updateServer } from "./update.js";

const COMMANDS = ["list", "get", "update", "rm", "remove"];

/** Manage servers and their deployment settings. */
export async function runServers(argv: readonly string[]): Promise<number> {
  const operation = argv[0];
  const help = cloudHelp("servers", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  if (operation === "update") return updateServer(argv.slice(1));
  return runCommand(argv, help, async (output) => {
    if (!COMMANDS.includes(operation ?? ""))
      throw new UsageError("Usage: mcp-use servers <list|get|update|rm>");
    const { values, positionals } = parseCloudArgs(
      argv.slice(1),
      {
        limit: { type: "string" },
        skip: { type: "string" },
        yes: { type: "boolean" },
      },
      `mcp-use servers ${operation} [server] [options]`,
      0,
      operation === "list" ? 0 : 1
    );
    const limit = integer(values.limit, "--limit", 30, 1, 100);
    const skip = integer(values.skip, "--skip", 0);
    if (operation === "list") {
      const cloud = await cloudFor(values);
      const page = await cloud.call(
        cloud.client.GET("/api/v1/servers", {
          params: {
            query: { organizationId: cloud.organization.id, limit, skip },
          },
        })
      );
      output.result(
        page,
        page.items
          .map(
            (item) =>
              `${item.id}\t${item.name ?? item.slug ?? "-"}\t${item.status}`
          )
          .join("\n") || "No servers."
      );
      return;
    }
    const { cloud, server, details } = await projectServer(
      values,
      positionals[0]
    );
    if (operation === "get") {
      output.result(details, human(details));
      return;
    }
    if (
      !(await confirm(`Remove server ${server}?`, {
        yes: values.yes === true,
        json: output.json,
      }))
    ) {
      output.result({ cancelled: true }, "Cancelled.");
      return;
    }
    const result = await cloud.call(
      cloud.client.DELETE("/api/v1/servers/{id}", {
        params: { path: { id: server } },
      })
    );
    output.result(result, `Removed ${server}.`);
  });
}
