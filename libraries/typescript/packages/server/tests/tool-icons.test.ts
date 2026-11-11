import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MCPServer, registerViews, type Icon } from "../src/index.js";

const remoteIcons: Icon[] = [
  {
    src: "https://cdn.example.test/light.svg?version=2",
    mimeType: "image/svg+xml",
    sizes: ["20x20"],
    theme: "light",
  },
  { src: "data:image/svg+xml,%3Csvg%2F%3E", sizes: ["any"], theme: "dark" },
];

describe("tool icons on tools/list", () => {
  it("preserves ordered icon fields in both registration overloads and keeps server branding separate", async () => {
    const serverIcons = [
      { src: "https://cdn.example.test/server.png", mimeType: "image/png" },
    ];
    const server = new MCPServer({
      name: "icons",
      version: "1",
      icons: serverIcons,
    });
    server.tool(
      { name: "with-schema", inputSchema: z.object({}), icons: remoteIcons },
      () => ({ content: [] })
    );
    server.tool({ name: "without-schema", icons: remoteIcons }, () => ({
      content: [],
    }));
    server.tool({ name: "empty", icons: [] }, () => ({ content: [] }));
    server.tool({ name: "fallback" }, () => ({ content: [] }));
    const before = JSON.stringify(remoteIcons);
    const client = new Client(
      { name: "icons-client", version: "1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL("https://icons.test/mcp"), {
          fetch: async (input, init) => server.fetch(new Request(input, init)),
        })
      );
      const { tools } = await client.listTools();
      expect(tools.find((tool) => tool.name === "with-schema")?.icons).toEqual(
        remoteIcons
      );
      expect(
        tools.find((tool) => tool.name === "without-schema")?.icons
      ).toEqual(remoteIcons);
      expect(tools.find((tool) => tool.name === "empty")?.icons).toEqual([]);
      expect(tools.find((tool) => tool.name === "fallback")).not.toHaveProperty(
        "icons"
      );
      expect(client.getServerVersion()?.icons).toEqual(serverIcons);
      expect(JSON.stringify(remoteIcons)).toBe(before);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each(["/mcp", "/api/mcp", "/"])(
    "resolves and serves tool-only public icons at basePath %s",
    async (basePath) => {
      const root = mkdtempSync(join(tmpdir(), "mcp-use-tool-icons-"));
      mkdirSync(join(root, "public", "icons"), { recursive: true });
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path stroke="currentColor"/></svg>';
      writeFileSync(join(root, "public", "icons", "book icon.svg"), svg);
      const server = new MCPServer({
        name: "local-icons",
        version: "1",
        basePath,
      });
      const icons: Icon[] = [
        {
          src: "icons/book icon.svg",
          mimeType: "image/svg+xml",
          sizes: ["20x20"],
        },
      ];
      server.tool({ name: "local", icons }, () => ({ content: [] }));
      server[registerViews]({}, { dev: true, projectRoot: root });
      const client = new Client(
        { name: "icons-client", version: "1" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } }
      );
      try {
        await client.connect(
          new StreamableHTTPClientTransport(
            new URL(`https://icons.test${basePath}`),
            {
              fetch: async (input, init) =>
                server.fetch(new Request(input, init)),
            }
          )
        );
        const { tools } = await client.listTools();
        const expected = `https://icons.test${basePath === "/" ? "" : basePath}/_mcp-use/public/icons/book%20icon.svg`;
        expect(tools[0]?.icons).toEqual([{ ...icons[0], src: expected }]);
        const response = await server.fetch(new Request(expected));
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/svg+xml");
        expect(await response.text()).toBe(svg);
        expect(icons[0]?.src).toBe("icons/book icon.svg");
        expect(client.getServerVersion()).not.toHaveProperty("icons");
      } finally {
        await client.close();
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});
