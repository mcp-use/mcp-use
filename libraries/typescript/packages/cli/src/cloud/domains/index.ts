import { plain } from "../../core/format.js";
import { formatDomain } from "./output.js";
import { cloudHelp } from "../help.js";
import { parseCommandArgs, runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";
import { confirm } from "../../core/prompt.js";
import { cloudWebUrl } from "../cloud-api.js";
import { connectProject, PROJECT_OPTIONS } from "../project/resolve.js";

const USAGE = "mcp-use domains <get|set-subdomain|add|verify|rm> [options]";

/** Manage a server's managed subdomain and custom domain. */
export async function runDomains(argv: readonly string[]): Promise<number> {
  const help = cloudHelp("domains", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    const command = argv[0] === "remove" ? "rm" : argv[0];
    if (
      !["get", "set-subdomain", "add", "verify", "rm"].includes(command ?? "")
    )
      throw new UsageError(`Usage: ${USAGE}`);
    const { values, positionals } = parseCommandArgs(argv.slice(1), {
      options: {
        ...PROJECT_OPTIONS,
        json: { type: "boolean" },
        ...(command === "add" ? { branch: { type: "string" as const } } : {}),
        ...(["get", "verify", "rm"].includes(command!)
          ? { "domain-id": { type: "string" as const } }
          : {}),
        ...(command === "rm" ? { yes: { type: "boolean" as const } } : {}),
      },
      positionals: command === "set-subdomain" || command === "add" ? 1 : 0,
      usage: USAGE,
    });
    const argument = positionals[0];
    if (
      command === "set-subdomain" &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(argument ?? "")
    )
      throw new UsageError(
        "Pass a lowercase subdomain containing letters, numbers, and hyphens."
      );
    if (
      command === "add" &&
      (!argument || /[/:\s]/.test(argument) || !argument.includes("."))
    )
      throw new UsageError(
        "Pass a hostname without a URL scheme, path, or port."
      );
    if (
      command === "rm" &&
      !(await confirm("Remove this custom domain?", {
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
    const id = found.id;
    const dashboardUrl = `${cloudWebUrl()}/cloud/${encodeURIComponent(cloud.organization.slug ?? cloud.organization.id)}/servers/${encodeURIComponent(id)}/domains`;
    const query =
      typeof values["domain-id"] !== "string"
        ? {}
        : { domainId: values["domain-id"] };
    if (command === "set-subdomain") {
      await cloud.call(
        cloud.client.PATCH("/api/v1/servers/{id}", {
          params: { path: { id } },
          body: { slug: argument! },
        })
      );
      output.result(
        { serverId: id, subdomain: argument, dashboardUrl },
        `✓ Subdomain set to ${plain(argument)}.`
      );
    } else if (command === "add") {
      const result = await cloud.call(
        cloud.client.POST("/api/v1/servers/{id}/domain/request", {
          params: { path: { id } },
          body: {
            domain: argument!,
            ...(typeof values.branch !== "string"
              ? {}
              : { branch: values.branch }),
          },
        })
      );
      output.result(
        { ...result, dashboardUrl },
        formatDomain(result, found.name ?? id, found.mcpUrl)
      );
    } else if (command === "verify") {
      const result = await cloud.call(
        cloud.client.POST("/api/v1/servers/{id}/domain/verify", {
          params: { path: { id }, query },
        })
      );
      output.result(
        { ...result, dashboardUrl },
        result.verified
          ? "Domain verified."
          : "Domain verification is pending. Check DNS records and try again."
      );
    } else if (command === "rm") {
      const result = await cloud.call(
        cloud.client.DELETE("/api/v1/servers/{id}/domain", {
          params: { path: { id }, query },
        })
      );
      output.result({ ...result, dashboardUrl }, `✓ ${plain(result.message)}`);
    } else {
      const result = await cloud.call(
        cloud.client.GET("/api/v1/servers/{id}/domain/status", {
          params: { path: { id }, query },
        })
      );
      output.result(
        { ...result, dashboardUrl },
        formatDomain(result, found.name ?? id, found.mcpUrl)
      );
    }
  });
}
