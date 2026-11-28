import { describe, expect, it } from "vitest";
import { supportsEvents } from "../../src/client/utils/eventsProtocol";

const server = (capabilities: Record<string, unknown> | undefined) =>
  ({ capabilities }) as any;

describe("supportsEvents", () => {
  it("accepts servers advertising capabilities.events", () => {
    expect(supportsEvents(server({ events: {} }))).toBe(true);
  });

  it("accepts SEP-only servers advertising the events extension", () => {
    expect(
      supportsEvents(
        server({ extensions: { "io.modelcontextprotocol/events": {} } })
      )
    ).toBe(true);
  });

  it("rejects servers without either placement", () => {
    expect(supportsEvents(server({ tools: {} }))).toBe(false);
    expect(supportsEvents(server({ extensions: { other: {} } }))).toBe(false);
    expect(supportsEvents(server(undefined))).toBe(false);
    expect(supportsEvents(undefined)).toBe(false);
  });
});
