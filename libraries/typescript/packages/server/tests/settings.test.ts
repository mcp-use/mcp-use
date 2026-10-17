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
      { scale: 0 },
      { scale: 11 },
      { grid: "true" },
      { grid: undefined },
    ]) {
      const result = await request(server, "tools/call", {
        name: "settings.update",
        arguments: { set },
      });
      expect(result.error ?? result.result?.isError).toBeTruthy();
    }
    for (const args of [
      {},
      { set: null },
      { set: [] },
      { set: { grid: false }, extra: true },
    ]) {
      const result = await request(server, "tools/call", {
        name: "settings.update",
        arguments: args,
      });
      expect(result.error ?? result.result?.isError).toBeTruthy();
    }
    const read = await request(server, "tools/call", {
      name: "settings.read",
      arguments: { extra: true },
    });
    expect(read.error ?? read.result?.isError).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
    await server.close();
  });
  it("rejects missing/unknown/invalid callback values and returns application errors", async () => {
    for (const value of [
      { units: "mm" },
      { ...defaults, extra: true },
      { ...defaults, scale: 100 },
      { ...defaults, grid: undefined },
      { ...defaults, scale: Number.NaN },
    ]) {
      const server = new MCPServer({ name: "invalid", version: "1" });
      server.settings({
        fields,
        read: () => value as typeof defaults,
        update: () => value as typeof defaults,
      });
      for (const name of ["settings.read", "settings.update"]) {
        const result = await request(server, "tools/call", {
          name,
          arguments: name === "settings.read" ? {} : { set: { grid: false } },
        });
        expect(result.result.isError).toBe(true);
      }
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
  it("rejects unsupported wire schemas without partial registrations", async () => {
    for (const schema of [
      z.object({}),
      z.array(z.string()),
      z.string().nullable(),
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
  });
  it("rejects value-changing validators instead of altering effective settings", async () => {
    // Overwrites retain identical primitive input/output JSON Schemas.
    const schema = z.number().overwrite((value) => value * 2);
    const server = new MCPServer({ name: "transformed", version: "1" });
    const update = vi.fn(() => ({ scale: 3 }));
    server.settings({
      fields: { scale: { schema, title: "Scale" } },
      read: () => ({ scale: 3 }),
      update,
    });
    const read = await request(server, "tools/call", {
      name: "settings.read",
      arguments: {},
    });
    expect(read.result.isError).toBe(true);
    expect(JSON.stringify(read.result)).toContain("must not transform values");
    const input = await request(server, "tools/call", {
      name: "settings.update",
      arguments: { set: { scale: 2 } },
    });
    expect(input.error ?? input.result?.isError).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
    // Zero is unchanged by the validator, so this reaches the callback.
    const output = await request(server, "tools/call", {
      name: "settings.update",
      arguments: { set: { scale: 0 } },
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(output.result.isError).toBe(true);
    expect(JSON.stringify(output.result)).toContain(
      "must not transform values"
    );
    await server.close();
  });
  it("rejects a same-type codec before persisting values its input parser cannot accept", async () => {
    const schema = z.codec(z.number().max(10), z.number().max(20), {
      decode: (value) => value * 2,
      encode: (value) => value / 2,
    });
    const server = new MCPServer({ name: "codec", version: "1" });
    const update = vi.fn((set: Partial<{ scale: number }>) => ({
      scale: set.scale ?? 0,
    }));
    server.settings({
      fields: { scale: { schema, title: "Scale" } },
      read: () => ({ scale: 0 }),
      update,
    });
    const result = await request(server, "tools/call", {
      name: "settings.update",
      arguments: { set: { scale: 6 } },
    });
    expect(result.error ?? result.result?.isError).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
    await server.close();
  });
  it("rejects empty fields before registering either settings tool", async () => {
    const server = new MCPServer({ name: "empty", version: "1" });
    expect(() =>
      server.settings({ fields: {}, read: () => ({}), update: () => ({}) })
    ).toThrow(/at least one field/);
    expect((await request(server, "tools/list")).result.tools).toEqual([]);
    await server.close();
  });
  it.each(
    [
      null,
      {},
      [null],
      [{ kind: "section", title: "Display", items: [] }],
      [{ kind: "group", title: " ", items: [] }],
      [{ kind: "group", title: "Display", items: {} }],
      [{ kind: "group", title: "Display", items: [null] }],
      [{ kind: "group", title: "Display", items: [{ kind: "unknown" }] }],
      [
        {
          kind: "group",
          title: "Display",
          items: [{ kind: "property", property: "untis" }],
        },
      ],
      [
        {
          kind: "group",
          title: "Display",
          items: [{ kind: "property", property: "toString" }],
        },
      ],
      [
        {
          kind: "group",
          title: "Display",
          items: [{ kind: "tool", tool: " ", title: "Open" }],
        },
      ],
      [
        {
          kind: "group",
          title: "Display",
          items: [{ kind: "tool", tool: "action", title: " " }],
        },
      ],
      [
        {
          kind: "group",
          title: "Display",
          items: [
            { kind: "tool", tool: "action", title: "Open", description: 42 },
          ],
        },
      ],
    ].map((layout) => ({ layout }))
  )(
    "rejects malformed untyped layout %# before registering tools",
    async ({ layout }) => {
      const server = new MCPServer({ name: "invalid-layout", version: "1" });
      expect(() =>
        server.settings({
          fields,
          layout: layout as never,
          read: () => defaults,
          update: () => defaults,
        })
      ).toThrow(/layout/i);
      expect((await request(server, "tools/list")).result.tools).toEqual([]);
      await server.close();
    }
  );
  it("supports schema defaults while requiring complete effective callback values", async () => {
    const server = new MCPServer({ name: "defaults", version: "1" });
    const read = vi.fn(() => ({ grid: true }));
    const update = vi.fn((set: Partial<{ grid: boolean }>) => ({
      grid: set.grid ?? true,
    }));
    server.settings({
      fields: {
        grid: { schema: z.boolean().default(true), title: "Show grid" },
      },
      read,
      update,
    });
    const result = await request(server, "tools/call", {
      name: "settings.read",
      arguments: {},
    });
    expect(result.result.structuredContent.values).toEqual({ grid: true });
    expect(
      result.result.structuredContent.schema.properties.grid
    ).toMatchObject({ type: "boolean", title: "Show grid" });
    expect(
      result.result.structuredContent.schema.properties.grid
    ).not.toHaveProperty("default");
    const changed = await request(server, "tools/call", {
      name: "settings.update",
      arguments: { set: { grid: false } },
    });
    expect(update.mock.calls[0]?.[0]).toEqual({ grid: false });
    expect(changed.result.structuredContent.values).toEqual({ grid: false });
    read.mockReturnValue({} as { grid: boolean });
    const missing = await request(server, "tools/call", {
      name: "settings.read",
      arguments: {},
    });
    expect(missing.result.isError).toBe(true);
    await server.close();
  });
  it("checks same-server action existence without preflighting arguments", async () => {
    for (const mode of ["missing", "required", "default"]) {
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
      const action = vi.fn((_args: { value: string }) => ({ content: [] }));
      if (mode !== "missing")
        server.tool(
          {
            name: "action",
            inputSchema:
              mode === "required"
                ? z.object({ value: z.string() })
                : z.object({ value: z.string().default("default") }),
          },
          action
        );
      if (mode === "missing") {
        await expect(request(server, "tools/list")).rejects.toThrow(
          /not registered/
        );
      } else {
        expect((await request(server, "server/discover")).result).toBeDefined();
        expect((await request(server, "tools/list")).result.tools).toHaveLength(
          3
        );
        expect(action).not.toHaveBeenCalled();
        const result = await request(server, "tools/call", {
          name: "action",
          arguments: {},
        });
        if (mode === "required") {
          expect(result.error ?? result.result?.isError).toBeTruthy();
          expect(action).not.toHaveBeenCalled();
        } else {
          expect(result.result.isError).not.toBe(true);
          expect(action.mock.calls[0]?.[0]).toEqual({ value: "default" });
        }
      }
      await server.close();
    }
  });
  it("runs sync and async action validators only when the action is invoked", async () => {
    for (const asyncValidation of [false, true]) {
      const schema = z
        .object({})
        .refine(() => (asyncValidation ? Promise.resolve(false) : false));
      const validate = vi.spyOn(schema["~standard"], "validate");
      const action = vi.fn(() => ({ content: [] }));
      const server = new MCPServer({ name: "refined-actions", version: "1" });
      server.tool({ name: "action", inputSchema: schema }, action);
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
      for (let i = 0; i < 2; i++) {
        expect((await request(server, "server/discover")).result).toBeDefined();
        expect((await request(server, "tools/list")).result.tools).toHaveLength(
          3
        );
      }
      expect(
        (
          await request(server, "tools/call", {
            name: "settings.read",
            arguments: {},
          })
        ).result.structuredContent.values
      ).toEqual(defaults);
      expect(validate).not.toHaveBeenCalled();
      const invoked = await request(server, "tools/call", {
        name: "action",
        arguments: {},
      });
      expect(invoked.error ?? invoked.result?.isError).toBeTruthy();
      expect(validate).toHaveBeenCalledTimes(1);
      expect(action).not.toHaveBeenCalled();
      await server.close();
    }
  });
  it("validates each callback result once and retains async update constraints", async () => {
    const schema = z.number().refine(async (value) => value <= 10);
    const validate = vi.spyOn(schema["~standard"], "validate");
    const server = new MCPServer({ name: "once", version: "1" });
    const update = vi.fn((set: Partial<{ scale: number }>) => ({
      scale: set.scale ?? 1,
    }));
    server.settings({
      fields: {
        scale: { schema, title: "Scale" },
      },
      read: () => ({ scale: 1 }),
      update,
    });
    await request(server, "server/discover");
    expect(validate).not.toHaveBeenCalled();
    const read = await request(server, "tools/call", {
      name: "settings.read",
      arguments: {},
    });
    expect(read.result.structuredContent.values).toEqual({ scale: 1 });
    expect(validate).toHaveBeenCalledTimes(1);
    validate.mockClear();
    const changed = await request(server, "tools/call", {
      name: "settings.update",
      arguments: { set: { scale: 2 } },
    });
    expect(changed.result.structuredContent.values).toEqual({ scale: 2 });
    expect(validate).toHaveBeenCalledTimes(2); // One input check and one result check.
    validate.mockClear();
    update.mockClear();
    const invalid = await request(server, "tools/call", {
      name: "settings.update",
      arguments: { set: { scale: 11 } },
    });
    expect(invalid.error ?? invalid.result?.isError).toBeTruthy();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    await server.close();
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
