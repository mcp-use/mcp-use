import type { Client } from "openapi-fetch";

import { integer, parseCloudArgs, projectServer } from "../options.js";
import { cloudHelp } from "../help.js";
import { runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";
import { withProgress } from "../../core/progress.js";

const USAGE = "mcp-use events <subscriptions|deliveries> [options]";

interface Subscription {
  id: string;
  name: string;
  callbackOrigin?: string;
  clientName?: string | null;
  refreshBefore?: string | null;
  lastDelivery?: { at: string; ok: boolean; status: number | null } | null;
}

interface Delivery {
  at: string;
  kind?: string;
  name: string;
  subscriptionId: string;
  status: number | null;
  ok: boolean;
  error?: string | null;
  attempt?: number;
}

/** Read a deployed server's MCP Events subscriptions and delivery history. */
export async function runEvents(argv: readonly string[]): Promise<number> {
  const help = cloudHelp("events", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    const command = argv[0];
    if (command !== "subscriptions" && command !== "deliveries")
      throw new UsageError(`Usage: ${USAGE}`);
    const { values } = parseCloudArgs(
      argv.slice(1),
      command === "deliveries"
        ? {
            limit: { type: "string" },
            subscription: { type: "string" },
          }
        : {},
      `mcp-use events ${command} [options]`
    );
    const limit = integer(
      (values as { limit?: string }).limit,
      "--limit",
      50,
      1,
      200
    );
    const result = await withProgress(
      `Loading event ${command}`,
      output.json,
      async () => {
        const project = await projectServer(values);
        // Not in the generated Cloud client yet.
        const client = project.cloud.client as unknown as Client<
          Record<string, Record<string, unknown>>
        >;
        const path = `/api/v1/servers/{id}/events/${command}`;
        const subscription = (values as { subscription?: string }).subscription;
        const data = (await project.cloud.call(
          client.GET(
            path as never,
            {
              params: {
                path: { id: project.server },
                ...(command === "deliveries" && {
                  query: {
                    limit,
                    ...(subscription && { subscriptionId: subscription }),
                  },
                }),
              },
            } as never
          ) as Promise<{ data?: unknown }>,
          { notFound: { code: "server_not_found" } }
        )) as { subscriptions?: Subscription[]; deliveries?: Delivery[] };
        if (command === "subscriptions") {
          const rows = data.subscriptions ?? [];
          return {
            value: { serverId: project.server, subscriptions: rows },
            human:
              rows
                .map((s) =>
                  [
                    s.id,
                    s.name,
                    s.callbackOrigin ?? "",
                    s.clientName ?? "",
                    `refresh before ${s.refreshBefore ?? "never"}`,
                    s.lastDelivery
                      ? `last ${s.lastDelivery.ok ? "ok" : "failed"} ${s.lastDelivery.status ?? ""} at ${s.lastDelivery.at}`
                      : "no deliveries",
                  ].join("\t")
                )
                .join("\n") || "No subscriptions.",
          };
        }
        const rows = data.deliveries ?? [];
        return {
          value: { serverId: project.server, deliveries: rows },
          human:
            rows
              .map((d) =>
                [
                  d.at,
                  d.kind ?? "event",
                  d.name,
                  d.subscriptionId,
                  d.ok ? "ok" : "failed",
                  d.status ?? d.error ?? "",
                  `attempt ${d.attempt ?? 1}`,
                ].join("\t")
              )
              .join("\n") || "No deliveries.",
        };
      }
    );
    output.result(result.value, result.human);
  });
}
