import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MCPServer } from "../../src/index.js";
import { defineEvent } from "../../src/events/define.js";
import type { AnyEventDefinition } from "../../src/events/types.js";

function codeOf(def: Partial<AnyEventDefinition>): string | undefined {
  const server = new MCPServer({ name: "r", version: "1.0.0", skills: false });
  try {
    server.event({
      name: "note.created",
      description: "d",
      payloadSchema: z.object({ folder: z.string() }),
      ...def,
    } as AnyEventDefinition);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("registration checks (§7.1.3)", () => {
  it("accepts a valid event", () => {
    expect(
      codeOf({ inputSchema: z.object({ folder: z.string() }) })
    ).toBeUndefined();
  });
  it.each([
    [{ name: "mcp.reserved" }, "EVENT_NAME_INVALID"],
    [{ name: "-bad" }, "EVENT_NAME_INVALID"],
    [
      { inputSchema: z.object({ minSeverity: z.number() }) },
      "EVENT_ARGUMENT_UNMATCHED",
    ],
    [{ partitionBy: "nope" }, "EVENT_PARTITION_INVALID"],
    [
      {
        payloadSchema: {
          "~standard": {
            version: 1,
            vendor: "x",
            validate: () => ({ value: 1 }),
          },
        },
      },
      "EVENT_SCHEMA_UNSUPPORTED",
    ],
    [{ replay: { maxAge: "10s" } }, "EVENT_REPLAY_INVALID"],
    [{ replay: { maxEvents: 0 } }, "EVENT_REPLAY_INVALID"],
    [{ replay: false, delivery: { poll: true } }, "EVENT_POLL_REQUIRES_REPLAY"],
    [
      { replay: false, delivery: { webhook: false, push: false } },
      "EVENT_NO_DELIVERY_MODE",
    ],
  ] as const)("%j throws %s", (def, code) => {
    expect(codeOf(def as Partial<AnyEventDefinition>)).toBe(code);
  });

  it("allows an unmatched argument when match is custom", () => {
    expect(
      codeOf({
        inputSchema: z.object({ minSeverity: z.number() }),
        match: () => true,
      })
    ).toBeUndefined();
  });

  it("throws EVENT_DUPLICATE for a second event with the same name", () => {
    const server = new MCPServer({
      name: "r",
      version: "1.0.0",
      skills: false,
    });
    const def = { name: "a", description: "d", payloadSchema: z.object({}) };
    server.event(def);
    expect(() => server.event(def)).toThrow(
      expect.objectContaining({ code: "EVENT_DUPLICATE" })
    );
  });

  it("defineEvent runs the same checks", () => {
    expect(() =>
      defineEvent({
        name: "mcp.x",
        description: "d",
        payloadSchema: z.object({}),
      })
    ).toThrow(expect.objectContaining({ code: "EVENT_NAME_INVALID" }));
  });

  it("validates emitted payloads", async () => {
    const server = new MCPServer({
      name: "r",
      version: "1.0.0",
      skills: false,
    });
    const ref = server.event({
      name: "a",
      description: "d",
      payloadSchema: z.object({ n: z.number() }),
    });
    await expect(ref.emit({ n: "x" } as never)).rejects.toMatchObject({
      code: "EVENT_PAYLOAD_INVALID",
    });
  });
});
