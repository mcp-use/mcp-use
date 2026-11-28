import { afterEach, describe, expect, it, vi } from "vitest";
import { MCPServer } from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MCP Events runtime startup failure", () => {
  it("reports the failure instead of an unhandled rejection, and close() still resolves", async () => {
    const failure = new Error("store unavailable");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const server = new MCPServer({
        name: "events",
        version: "1.0.0",
        logging: { enabled: false },
        events: {
          get store(): never {
            throw failure;
          },
        },
      });
      const noteCreated = server.event({ name: "note.created" });

      // Any request mounts the endpoint, which starts the runtime eagerly.
      await server.fetch(
        new Request("http://localhost/mcp", { method: "GET" })
      );
      await expect(noteCreated.emit({})).rejects.toBe(failure);
      await server.close();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).toEqual([]);
      expect(consoleError).toHaveBeenCalledWith(
        "[mcp-use] MCP Events runtime failed to start:",
        failure
      );
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
