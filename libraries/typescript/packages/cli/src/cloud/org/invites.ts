import { cloudHelp } from "../help.js";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";
import { connectCloud } from "../api/client.js";

/** List, send, or cancel an organization invitation. */
export async function runOrgInvites(argv: readonly string[]): Promise<number> {
  const usage =
    "mcp-use org invites <list|send <email>|cancel <invite-id>> [--org <id-or-slug>] [--role member|admin] [--json]";
  const help = cloudHelp("org", ["invites", ...argv]);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    const command = argv[0];
    if (!["list", "send", "cancel"].includes(command ?? ""))
      throw new UsageError(`Usage: ${usage}`);
    const { values, positionals } = parseCommandArgs(argv.slice(1), {
      options: {
        org: { type: "string" },
        json: { type: "boolean" },
        ...(command === "send" ? { role: { type: "string" as const } } : {}),
      },
      positionals: command === "list" ? 0 : 1,
      usage,
    });
    const role = typeof values.role === "string" ? values.role : "member";
    if (command === "send" && !["member", "admin"].includes(role))
      throw new UsageError("Pass --role member or --role admin.");
    if (
      command === "send" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(positionals[0]!)
    )
      throw new UsageError("Pass a valid email address.");
    const cloud = await connectCloud({
      organization: values.org ?? process.env["MANUFACT_ORG"],
    });
    const id = cloud.organization.id;
    if (command === "list") {
      const result = await cloud.call(
        cloud.client.GET("/api/v1/organizations/{id}/invitations", {
          params: { path: { id } },
        })
      );
      output.result(
        result,
        result.invitations
          .map(
            (invite) =>
              `${invite.id}\t${invite.email}\t${invite.role ?? "member"}\t${invite.status}`
          )
          .join("\n") || "No invitations."
      );
    } else if (command === "send") {
      const result = await cloud.call(
        cloud.client.POST("/api/v1/organizations/{id}/invitations", {
          params: { path: { id } },
          body: { email: positionals[0]!, role },
        })
      );
      output.result(result, `Invitation sent to ${result.email}.`);
    } else {
      const result = await cloud.call(
        cloud.client.POST(
          "/api/v1/organizations/{id}/invitations/{invitationId}/cancel",
          { params: { path: { id, invitationId: positionals[0]! } } }
        )
      );
      output.result(result, `Invitation ${result.id} cancelled.`);
    }
  });
}
