import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MCPServer } from "../../../src/index.js";
import { legacy, modern, post } from "./helpers.js";

function noteServer(): MCPServer {
  const server = new MCPServer({
    name: "notes",
    version: "1.0.0",
    skills: false,
  });
  server.event({
    name: "note.created",
    description: "A note was created.",
    inputSchema: z.object({ folder: z.string() }),
    payloadSchema: z.object({ folder: z.string(), noteId: z.string() }),
  });
  server.event({
    name: "note.deleted",
    description: "A note was deleted.",
    payloadSchema: z.object({ noteId: z.string() }),
    replay: false,
  });
  return server;
}

describe("events/list", () => {
  it("lists servable modes on a modern no-OAuth server with resultType complete", async () => {
    const { status, headers, json } = await modern(
      noteServer(),
      "events/list",
      {}
    );
    expect(status).toBe(200);
    expect(headers.get("x-mcp-use-events-dialect")).toBe("sep-3415");
    expect(json).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        resultType: "complete",
        events: [
          {
            name: "note.created",
            description: "A note was created.",
            delivery: ["push", "poll"],
            inputSchema: {
              type: "object",
              properties: { folder: { type: "string" } },
              required: ["folder"],
              additionalProperties: false,
            },
            payloadSchema: {
              type: "object",
              properties: {
                folder: { type: "string" },
                noteId: { type: "string" },
              },
              required: ["folder", "noteId"],
              additionalProperties: false,
            },
          },
          {
            name: "note.deleted",
            description: "A note was deleted.",
            delivery: ["push"],
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            payloadSchema: {
              type: "object",
              properties: { noteId: { type: "string" } },
              required: ["noteId"],
              additionalProperties: false,
            },
          },
        ],
      },
    });
  });

  it("omits events without webhook for the openai profile on legacy, with no resultType", async () => {
    const { json } = await legacy(noteServer(), "events/list", {});
    expect(json).toEqual({ jsonrpc: "2.0", id: 1, result: { events: [] } });
  });
});

describe("batch rule", () => {
  it("rejects a batch containing events/* with HTTP 400 and one -32600 per member", async () => {
    const { status, json } = await post(noteServer(), [
      { jsonrpc: "2.0", id: 1, method: "events/list", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "events/poll", params: {} },
    ]);
    expect(status).toBe(400);
    expect(json).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32600,
          message: "Invalid Request",
          data: { reason: "events_in_batch" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 3,
        error: {
          code: -32600,
          message: "Invalid Request",
          data: { reason: "events_in_batch" },
        },
      },
    ]);
  });
});

describe("Mcp-Name", () => {
  it("answers HTTP 400 / -32020 when Mcp-Name disagrees with params.name", async () => {
    const { status, json } = await modern(
      noteServer(),
      "events/poll",
      { name: "note.created", arguments: { folder: "a" } },
      { "mcp-name": "note.deleted" }
    );
    expect(status).toBe(400);
    expect(json).toMatchObject({
      id: 1,
      error: { code: -32020, data: { header: "Mcp-Name" } },
    });
  });

  it("decodes the base64 sentinel before comparing", async () => {
    const encoded = `=?base64?${Buffer.from("note.created").toString("base64")}?=`;
    const { json } = await modern(
      noteServer(),
      "events/poll",
      { name: "note.created", arguments: { folder: "a" } },
      { "mcp-name": encoded }
    );
    // Passes the header check and is answered by the engine (memory binding).
    expect(json).toMatchObject({
      result: { events: [], hasMore: false },
    });
  });

  it("accepts a missing Mcp-Name under the lenient default", async () => {
    const { json } = await modern(noteServer(), "events/poll", {
      name: "note.created",
      arguments: { folder: "a" },
    });
    expect(json).toMatchObject({
      result: { events: [], hasMore: false },
    });
  });

  it("rejects a mismatching Mcp-Method through the SDK ladder", async () => {
    const { status, json } = await modern(
      noteServer(),
      "events/list",
      {},
      { "mcp-method": "tools/call" }
    );
    expect(status).toBe(400);
    expect(json).toMatchObject({ error: { code: -32020 } });
  });
});

describe("era gate", () => {
  it("answers -32601 to events/poll on the legacy era", async () => {
    const { json } = await legacy(noteServer(), "events/poll", {
      name: "note.created",
    });
    expect(json).toMatchObject({ id: 1, error: { code: -32601 } });
  });
});
