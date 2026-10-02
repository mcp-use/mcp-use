import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { MCPServer, type SettingsValues } from "../src/index.js";

async function request(
  server: MCPServer,
  method: string,
  params: Record<string, unknown> = {},
  version = "2026-07-28"
) {
  const response = await server.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": version,
        "mcp-method": method,
        ...(typeof params["name"] === "string" && {
          "mcp-name": params["name"],
        }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": version,
            "io.modelcontextprotocol/clientInfo": {
              name: "settings-test",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    })
  );
  const body = await response.text();
  const data = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? body
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : body;
  return JSON.parse(data ?? "{}");
}
const fields = {
  units: { schema: z.enum(["mm", "in"]), title: "Units" },
  grid: { schema: z.boolean().optional(), title: "Show grid" },
  scale: {
    schema: z.number().int().min(1).max(10),
    title: "Scale",
    description: "Drawing scale",
  },
};
const defaults: SettingsValues<typeof fields> = {
  units: "mm",
  grid: true,
  scale: 1,
};

function create() {
  const server = new MCPServer({ name: "settings-test", version: "1.0.0" });
  let values = { ...defaults };
  const read = vi.fn((ctx) => {
    expect(ctx.request?.raw.url).toBe("http://localhost/mcp");
    expect(ctx.client.info().name).toBe("settings-test");
    return { ...values };
  });
  const update = vi.fn((set, ctx) => {
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    values = { ...values, ...set };
    return { ...values };
  });
  server.settings({
    fields,
    layout: [
      {
        kind: "group",
        title: "Display",
        items: [{ kind: "property", property: "units" }],
      },
    ],
    read,
    update,
  });
  return { server, read, update };
}

describe("native settings", () => {
  it("advertises capabilities on every per-request server and exposes read-only typed tools", async () => {
    const { server, read } = create();
    expect(read).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      const discovery = await request(server, "server/discover");
      expect(
        discovery.result.capabilities.extensions["openai/settings"]
      ).toEqual({ readTool: "settings.read", updateTool: "settings.update" });
    }
    const listing = await request(server, "tools/list");
    const readTool = listing.result.tools.find(
      (tool: { name: string }) => tool.name === "settings.read"
    );
    expect(readTool.annotations.readOnlyHint).toBe(true);
    expect(readTool.outputSchema.required).toEqual(["schema", "values"]);
    const result = await request(server, "tools/call", {
      name: "settings.read",
      arguments: {},
    });
    expect(result.result.structuredContent.values).toEqual(defaults);
    expect(
      result.result.structuredContent.schema.properties.units
    ).toMatchObject({ type: "string", enum: ["mm", "in"], title: "Units" });
    expect(result.result.structuredContent.layout[0].items).toEqual([
      { kind: "property", property: "units" },
    ]);
    await server.close();
  });
  it("advertises settings in legacy initialization", async () => {
    const { server } = create();
    const initialized = await request(
      server,
      "initialize",
      {
        protocolVersion: "2025-11-25",
        clientInfo: { name: "settings-test", version: "1.0.0" },
        capabilities: {},
      },
      "2025-11-25"
    );
    expect(
      initialized.result.capabilities.extensions?.["openai/settings"] ??
        initialized.result.capabilities.experimental?.["openai/settings"]
    ).toEqual({ readTool: "settings.read", updateTool: "settings.update" });
    await server.close();
  });
  it("passes only changed keys and validates every complete effective result", async () => {
    const { server, update } = create();
    const result = await request(server, "tools/call", {
      name: "settings.update",
      arguments: { set: { units: "in" } },
    });
    expect(update.mock.calls[0]?.[0]).toEqual({ units: "in" });
    expect(result.result.structuredContent.values).toEqual({
      ...defaults,
      units: "in",
    });
    const reread = await request(server, "tools/call", {
      name: "settings.read",
      arguments: {},
    });
    expect(reread.result.structuredContent.values.units).toBe("in");
    await server.close();
  });
  it("rejects empty, unknown and invalid patches before calling persistence", async () => {
    const { server, update } = create();
    for (const set of [
      {},
      { missing: true },
      { units: "cm" },
      { scale: 1.5 },
      { grid: undefined },
    ]) {
      const result = await request(server, "tools/call", {
        name: "settings.update",
        arguments: { set },
      });
      expect(result.error ?? result.result?.isError).toBeTruthy();
    }
    expect(update).not.toHaveBeenCalled();
    await server.close();
  });
  it("rejects missing/unknown/invalid callback values and returns application errors", async () => {
    for (const value of [
      { units: "mm" },
      { ...defaults, extra: true },
      { ...defaults, scale: 100 },
    ]) {
      const server = new MCPServer({ name: "invalid", version: "1" });
      server.settings({
        fields,
        read: () => value as typeof defaults,
        update: () => defaults,
      });
      expect(
        (
          await request(server, "tools/call", {
            name: "settings.read",
            arguments: {},
          })
        ).result.isError
      ).toBe(true);
      await server.close();
    }
    const server = new MCPServer({ name: "failure", version: "1" });
    server.settings({
      fields,
      read: () => defaults,
      update: () => {
        throw new Error("Persistence failed");
      },
    });
    expect(
      (
        await request(server, "tools/call", {
          name: "settings.update",
          arguments: { set: { grid: false } },
        })
      ).result.isError
    ).toBe(true);
    await server.close();
  });
  it("rejects unsupported schemas, defaults and layout errors without partial registrations", async () => {
    for (const schema of [
      z.object({}),
      z.array(z.string()),
      z.string().nullable(),
      z.boolean().default(true),
      z.string().transform((value) => value.length),
    ]) {
      const server = new MCPServer({ name: "invalid", version: "1" });
      expect(() =>
        server.settings({
          fields: { invalid: { schema, title: "Invalid" } },
          read: () => ({ invalid: "test" }) as never,
          update: () => ({ invalid: "test" }) as never,
        })
      ).toThrow();
      expect((await request(server, "tools/list")).result.tools).toEqual([]);
      await server.close();
    }
    const server = new MCPServer({ name: "layout", version: "1" });
    expect(() =>
      server.settings({
        fields,
        layout: [
          {
            kind: "group",
            title: "Display",
            items: [
              { kind: "property", property: "units" },
              { kind: "property", property: "units" },
            ],
          },
        ],
        read: () => defaults,
        update: () => defaults,
      })
    ).toThrow(/duplicate/);
  });
  it("validates same-server layout actions at mount and allows optional/default arguments", async () => {
    for (const mode of ["missing", "required", "valid"]) {
      const server = new MCPServer({ name: "actions", version: "1" });
      server.settings({
        fields,
        layout: [
          {
            kind: "group",
            title: "More",
            items: [{ kind: "tool", tool: "action", title: "Open" }],
          },
        ],
        read: () => defaults,
        update: () => defaults,
      });
      if (mode !== "missing")
        server.tool(
          {
            name: "action",
            inputSchema:
              mode === "required"
                ? z.object({ value: z.string() })
                : z.object({ value: z.string().default("default") }),
          },
          () => ({ content: [] })
        );
      if (mode === "valid")
        expect((await request(server, "tools/list")).result.tools).toHaveLength(
          3
        );
      else
        await expect(request(server, "tools/list")).rejects.toThrow(
          /not registered|empty arguments/
        );
      await server.close();
    }
  });
  it("rejects action schemas whose actual empty-argument validation fails, including async schemas", async () => {
    for (const schema of [
      z.object({}).refine(() => false),
      z.object({}).refine(async () => false),
    ]) {
      const server = new MCPServer({ name: "refined-actions", version: "1" });
      server.tool({ name: "action", inputSchema: schema }, () => ({
        content: [],
      }));
      server.settings({
        fields,
        layout: [
          {
            kind: "group",
            title: "Actions",
            items: [{ kind: "tool", tool: "action", title: "Open" }],
          },
        ],
        read: () => defaults,
        update: () => defaults,
      });
      expect((await request(server, "server/discover")).error).toBeDefined();
      await server.close();
    }
  });
  it("captures schema references at registration", async () => {
    const server = new MCPServer({ name: "capture", version: "1" });
    const field = { schema: z.string() as z.ZodType, title: "Name" };
    server.settings({
      fields: { name: field },
      read: () => ({ name: 1 }),
      update: () => ({ name: 1 }),
    });
    field.schema = z.number();
    expect(
      (
        await request(server, "tools/call", {
          name: "settings.read",
          arguments: {},
        })
      ).result.isError
    ).toBe(true);
    await server.close();
  });
  it("supports custom names and protects a single registration from tool collisions", async () => {
    const server = new MCPServer({ name: "names", version: "1" });
    server.tool({ name: "occupied" }, () => ({ content: [] }));
    expect(() =>
      server.settings({
        fields,
        readTool: "occupied",
        read: () => defaults,
        update: () => defaults,
      })
    ).toThrow(/already/);
    server.settings({
      fields,
      readTool: "preferences.read",
      updateTool: "preferences.update",
      read: () => defaults,
      update: () => defaults,
    });
    expect(() =>
      server.settings({ fields, read: () => defaults, update: () => defaults })
    ).toThrow(/already/);
    expect(() =>
      server.tool({ name: "preferences.read" }, () => ({ content: [] }))
    ).toThrow(/reserved/);
    expect(
      (await request(server, "server/discover")).result.capabilities.extensions[
        "openai/settings"
      ].readTool
    ).toBe("preferences.read");
    expect(() =>
      server.settings({ fields, read: () => defaults, update: () => defaults })
    ).toThrow(/started|registered/);
    await server.close();
  });
  it("infers values, partial updates, layout keys and the ordinary callback context", () => {
    const server = new MCPServer({ name: "types", version: "1" });
    server.settings({
      fields,
      read: (ctx) => {
        expectTypeOf(ctx.auth).toEqualTypeOf<undefined>();
        return defaults;
      },
      update: (set) => {
        expectTypeOf(set.units).toEqualTypeOf<"mm" | "in" | undefined>();
        expectTypeOf(set.grid).toEqualTypeOf<boolean | undefined>();
        return defaults;
      },
    });
  });
});
