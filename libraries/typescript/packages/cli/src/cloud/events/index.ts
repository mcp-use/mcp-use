import type { Client } from "openapi-fetch";

import { parseCloudArgs, projectServer } from "../options.js";
import { cloudHelp } from "../help.js";
import { runCommand } from "../../core/command.js";
import { UsageError } from "../../core/errors.js";
import { date, table } from "../../core/format.js";
import { withProgress } from "../../core/progress.js";

const USAGE = "mcp-use events subscriptions [options]";

/** One subscription as the Cloud reconstructs it from gateway analytics. */
interface Subscription {
  id: string;
  name: string;
  arguments?: unknown;
  callbackOrigin?: string | null;
  clientName?: string | null;
  dialect?: string | null;
  mode?: "webhook" | "poll";
  createdAt?: string | null;
  lastRefreshAt?: string | null;
  refreshBefore?: string | null;
  expiresAt?: string | null;
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 16)}…` : id;
}

function argumentsText(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text === "{}" ? "" : text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** Read a deployed server's MCP Events subscriptions. */
export async function runEvents(argv: readonly string[]): Promise<number> {
  const help = cloudHelp("events", argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    const command = argv[0];
    if (command !== "subscriptions") throw new UsageError(`Usage: ${USAGE}`);
    const { values } = parseCloudArgs(
      argv.slice(1),
      {},
      "mcp-use events subscriptions [options]"
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
        const data = (await project.cloud.call(
          client.GET(
            path as never,
            {
              params: { path: { id: project.server } },
            } as never
          ) as Promise<{ data?: unknown }>,
          { notFound: { code: "server_not_found" } }
        )) as { subscriptions?: Subscription[] };
        const rows = data.subscriptions ?? [];
        return {
          value: { ...data, subscriptions: rows },
          human: rows.length
            ? table(
                [
                  "ID",
                  "EVENT",
                  "ARGUMENTS",
                  "CLIENT",
                  "DIALECT",
                  "DELIVERY",
                  "CREATED",
                  "LAST REFRESH",
                  "REFRESH BEFORE",
                ],
                rows.map((s) => [
                  shortId(s.id),
                  s.name,
                  argumentsText(s.arguments),
                  s.clientName,
                  s.dialect,
                  s.mode === "poll" ? "poll" : (s.callbackOrigin ?? ""),
                  date(s.createdAt),
                  date(s.lastRefreshAt),
                  date(s.refreshBefore),
                ])
              )
            : "No subscriptions.",
        };
      }
    );
    output.result(result.value, result.human);
  });
}
