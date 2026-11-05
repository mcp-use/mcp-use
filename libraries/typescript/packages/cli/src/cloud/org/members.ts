import { cloudHelp } from "../help.js";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";
import { connectCloud } from "../api/client.js";

/** List members of the selected organization. */
export async function runOrgMembers(argv: readonly string[]): Promise<number> {
  const usage =
    "mcp-use org members [--org <id-or-slug>] [--limit <n>] [--skip <n>] [--json]";
  const help = cloudHelp("org", ["members", ...argv]);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    const { values } = parseCommandArgs(argv, {
      options: {
        org: { type: "string" },
        limit: { type: "string" },
        skip: { type: "string" },
        json: { type: "boolean" },
      },
      positionals: 0,
      usage,
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
        "Pass --limit between 1 and 100 and --skip as a non-negative integer."
      );
    const cloud = await connectCloud({
      organization: values.org ?? process.env["MANUFACT_ORG"],
    });
    const result = await cloud.call(
      cloud.client.GET("/api/v1/organizations/{id}/members", {
        params: {
          path: { id: cloud.organization.id },
          query: { limit, skip },
        },
      })
    );
    output.result(
      result,
      result.items
        .map(
          (member) =>
            `${member.user.email}\t${member.role}\t${member.user.name}`
        )
        .join("\n") || "No members."
    );
  });
}
