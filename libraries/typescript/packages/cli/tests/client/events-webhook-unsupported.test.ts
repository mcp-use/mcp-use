import { describe, expect, it } from "vitest";

import { UsageError } from "../../src/core/errors.js";
import { parseEventsArgs, runEventsCommand } from "../../src/client/events.js";

/** A connection answering events/list like FastMCP (poll and push only). */
function fastmcpLike(subscribeError?: unknown) {
  const methods: string[] = [];
  const connection = {
    request: async (method: string) => {
      methods.push(method);
      if (method === "events/list")
        return {
          events: [
            { name: "ticks", delivery: ["poll", "push"] },
            { name: "hooks", delivery: ["webhook"] },
          ],
        };
      if (subscribeError) throw subscribeError;
      return { id: "sub-1", refreshBefore: "later", cursor: null };
    },
  };
  return { connection: connection as never, methods };
}

const subscribeArgs = (event: string) =>
  parseEventsArgs("demo", "subscribe", [
    event,
    "--url",
    "https://hook.example.com",
    "--secret",
    "s",
  ]);

describe("events subscribe without webhook delivery", () => {
  it("refuses before subscribing and points at events poll", async () => {
    const { connection, methods } = fastmcpLike();

    const run = runEventsCommand(connection, subscribeArgs("ticks"), {}, true);

    await expect(run).rejects.toBeInstanceOf(UsageError);
    await expect(run).rejects.toThrow(
      'Event "ticks" supports only poll, push delivery, not webhook. Use `events poll ticks` instead.'
    );
    expect(methods).toEqual(["events/list"]);
  });

  it("maps -32601 from events/subscribe to a friendly usage error", async () => {
    const { connection } = fastmcpLike(
      Object.assign(new Error("Method not found"), { code: -32601 })
    );

    const run = runEventsCommand(connection, subscribeArgs("hooks"), {}, true);

    await expect(run).rejects.toThrow(
      "The server does not support webhook delivery (events/subscribe is not implemented). Use `events poll` instead."
    );
  });
});
