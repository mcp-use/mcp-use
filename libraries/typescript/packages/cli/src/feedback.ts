import { randomUUID } from "node:crypto";

import { parseCommandArgs, runCommand } from "./core/command.js";
import { CommandError, UsageError } from "./core/errors.js";
import { posthogEndpoint, posthogEvent } from "./posthog.js";
import { commandProperties, installationId } from "./telemetry.js";

const USAGE = "mcp-use feedback send --message <text> [options]";
const HELP = `Usage: mcp-use feedback <send> [options]

Send feedback about the CLI to Manufact through PostHog. No login required.

Commands:
  send              Submit a report

Options for send:
  --message <text>   Required report text (1–10,000 characters)
  --command <name>   Related command, e.g. deploy or "env push"
  --source <source>  user (default) or agent
  --json             Print one JSON result, including failures
  -h, --help         Show this help

Only the supplied report and basic CLI metadata are sent. Omit secrets and
personal data. Explicit submissions work even when usage analytics is disabled.
Requests time out after 10 seconds and are not retried automatically.

Exit codes: 0 accepted/help, 1 delivery failed, 2 invalid arguments`;
const SEND_HELP = HELP.replace(
  "Usage: mcp-use feedback <send> [options]",
  `Usage: ${USAGE}`
);

/** Submit explicit CLI feedback independently of passive usage analytics. */
export async function runFeedback(argv: readonly string[]): Promise<number> {
  const help = argv[0] === "send" ? SEND_HELP : HELP;
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${help}\n`);
    return 0;
  }
  return runCommand(argv, help, async (output) => {
    if (argv[0] !== "send") throw new UsageError(`Usage: ${USAGE}`);
    const { values } = parseCommandArgs(argv.slice(1), {
      options: {
        message: { type: "string" },
        command: { type: "string" },
        source: { type: "string" },
        json: { type: "boolean" },
      },
      positionals: 0,
      usage: USAGE,
    });
    const message = values.message?.trim();
    if (!message || message.length > 10_000)
      throw new UsageError("Pass --message with 1–10,000 characters.");
    const source = values.source ?? "user";
    if (source !== "user" && source !== "agent")
      throw new UsageError("Pass --source user or --source agent.");
    let relatedCommand: string | undefined;
    if (values.command !== undefined) {
      const parts = values.command.trim().split(/\s+/);
      const known = commandProperties(parts);
      const normalized = [known.command, known.subcommand]
        .filter(Boolean)
        .join(" ");
      if (
        ["unknown", "version", "help"].includes(known.command) ||
        normalized !== parts.join(" ")
      )
        throw new UsageError(
          "Pass a known command name, e.g. --command deploy or --command 'env push'."
        );
      relatedCommand = normalized;
    }

    const reportId = randomUUID();
    const event = {
      ...posthogEvent(
        "mcp_use_cli_feedback",
        installationId() ?? randomUUID(),
        {
          message,
          source,
          report_id: reportId,
          ...(relatedCommand !== undefined && {
            related_command: relatedCommand,
          }),
        }
      ),
      uuid: reportId,
    };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new CommandError(
              "feedback_timeout",
              "Feedback delivery timed out; acceptance is unknown. Check your connection before trying again."
            )
          );
          controller.abort();
        }, 10_000);
      });
      const response = await Promise.race([
        fetch(posthogEndpoint(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event),
          signal: controller.signal,
          redirect: "error",
        }),
        timeout,
      ]);
      if (!response.ok)
        throw new CommandError(
          "feedback_rejected",
          `Feedback was rejected (HTTP ${response.status}).`
        );
    } catch (error) {
      if (error instanceof CommandError) throw error;
      // Do not echo response bodies, report contents or low-level network data.
      throw new CommandError(
        "feedback_network_error",
        "Could not confirm feedback acceptance. Check your connection before trying again."
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    output.result(
      { accepted: true, reportId },
      `Feedback accepted. Report ID: ${reportId}`
    );
  });
}
