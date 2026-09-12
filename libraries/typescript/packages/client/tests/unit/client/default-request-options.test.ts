import { describe, expect, it } from "vitest";

import { BaseConnector } from "../../../src/transport/base.js";

/**
 * `defaultRequestOptions` is documented as the options helper methods use when
 * they issue SDK requests, overridable per call. Only `initialize` read it, so
 * a caller that omitted options silently got the SDK defaults instead of the
 * timeout and cancellation settings the server config asked for.
 */
class ProbeConnector extends BaseConnector {
  async connect(): Promise<void> {}

  get publicIdentifier(): Record<string, string> {
    return { type: "probe" };
  }
}

/** Options each SDK call was invoked with, keyed by method. */
function connectorWithRecorder(defaults?: Record<string, unknown>): {
  connector: ProbeConnector;
  seen: Record<string, unknown>;
} {
  const seen: Record<string, unknown> = {};
  const connector = new ProbeConnector(
    (defaults === undefined ? {} : { defaultRequestOptions: defaults }) as never
  );
  Object.assign(connector as never as Record<string, unknown>, {
    capabilitiesCache: { prompts: {}, resources: {} },
    client: {
      async listTools(_params: unknown, options: unknown) {
        seen["listTools"] = options;
        return { tools: [] };
      },
      async callTool(_params: unknown, options: unknown) {
        seen["callTool"] = options;
        return { content: [] };
      },
      async readResource(_params: unknown, options: unknown) {
        seen["readResource"] = options;
        return { contents: [] };
      },
      async listPrompts(_params: unknown, options: unknown) {
        seen["listPrompts"] = options;
        return { prompts: [] };
      },
    },
  });
  return { connector, seen };
}

async function exercise(connector: ProbeConnector): Promise<void> {
  await connector.listTools();
  await connector.callTool("tool", {});
  await connector.readResource("file:///x");
  await connector.listPrompts();
}

describe("defaultRequestOptions", () => {
  it("reaches every helper method when the caller omits options", async () => {
    const { connector, seen } = connectorWithRecorder({ timeout: 1234 });

    await exercise(connector);

    expect(seen).toEqual({
      listTools: { timeout: 1234 },
      callTool: { timeout: 1234 },
      readResource: { timeout: 1234 },
      listPrompts: { timeout: 1234 },
    });
  });

  it("lets a per-call option win over the configured default", async () => {
    const { connector, seen } = connectorWithRecorder({
      timeout: 1234,
      resetTimeoutOnProgress: true,
    });

    await connector.listTools({ timeout: 9 });

    expect(seen["listTools"]).toEqual({
      timeout: 9,
      resetTimeoutOnProgress: true,
    });
  });

  it("passes nothing when no defaults are configured", async () => {
    const { connector, seen } = connectorWithRecorder();

    await exercise(connector);

    expect(Object.values(seen)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
