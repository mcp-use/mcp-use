import { randomUUID } from "node:crypto";

import { parseCommandArgs, runCommand } from "./core/command.js";
import { CommandError, UsageError } from "./core/errors.js";
import { posthogEndpoint, posthogEvent } from "./posthog.js";
import { installationId } from "./telemetry.js";

const USAGE = "mcp-use feedback send <message> [options]";
const HELP = `Usage: mcp-use feedback <send> [options]

Send feedback about the CLI to Manufact through PostHog. No login required.

Commands:
  send              Submit a report

Arguments for send:
  <message>          Required report text (1–10,000 characters); quote spaces

Options:
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
    const { positionals } = parseCommandArgs(argv.slice(1), {
      options: {
        json: { type: "boolean" },
      },
      positionals: 1,
      usage: USAGE,
    });
    const message = positionals[0]?.trim();
    if (!message || [...message].length > 10_000)
      throw new UsageError("Pass a quoted message with 1–10,000 characters.");
    const reportId = randomUUID();
    const event = {
      ...posthogEvent(
        "mcp_use_cli_feedback",
        installationId() ?? randomUUID(),
        {
          message,
          report_id: reportId,
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
