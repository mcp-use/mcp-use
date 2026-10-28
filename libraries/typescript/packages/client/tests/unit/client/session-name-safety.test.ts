import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { MCPClient } from "../../../src/core/node.js";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

describe("session names matching Object.prototype properties", () => {
  it.each(["__proto__", "constructor", "toString"])(
    "does not return a nonexistent session for %s",
    (name) => {
      const client = new MCPClient();
      expect(client.getSession(name)).toBeNull();
      expect(() => client.requireSession(name)).toThrow("not found");
    }
  );

  it.each(["calculator", "__proto__", "constructor", "toString"])(
    "discovers tools, calls them, and closes the real server named %s",
    async (name) => {
      // Object.fromEntries creates an own __proto__ property, as JSON config does.
      const client = new MCPClient({
        mcpServers: Object.fromEntries([
          [
            name,
            {
              command: process.execPath,
              args: [
                fileURLToPath(
                  new URL(
                    "../../fixtures/session-name-stdio-server.mjs",
                    import.meta.url
                  )
                ),
              ],
            },
          ],
        ]),
      });
      const session = await client.createSession(name);
      try {
        expect((await session.listTools()).map((tool) => tool.name)).toEqual([
          "square",
        ]);
        const result = await session.callTool("square", { value: 7 });
        const content = result.content[0];
        if (content.type !== "text")
          throw new Error("Expected a text tool result");
        const output = JSON.parse(content.text) as {
          square: number;
          pid: number;
        };
        expect(output.square).toBe(49);
        expect(isAlive(output.pid)).toBe(true);

        await client.close();

        expect(session.isConnected).toBe(false);
        expect(client.activeSessions).toEqual([]);
        expect(client.getSession(name)).toBeNull();
        expect(() => client.requireSession(name)).toThrow("not found");
        await vi.waitFor(() => expect(isAlive(output.pid)).toBe(false), {
          timeout: 3000,
        });
      } finally {
        // Also clean up on the unfixed implementation, where client.close() leaks it.
        await session.disconnect();
        await client.close();
      }
    }
  );
});
