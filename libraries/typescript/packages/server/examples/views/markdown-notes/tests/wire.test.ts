import { readFile, rm, symlink } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { registerViews } from "mcp-use";
import { afterAll, describe, expect, it } from "vitest";

import server from "../src/index.js";
import { findNote } from "../src/notes.js";

// Mocked empty View assets only. Registration, schemas, resource resolvers,
// tool callbacks, and the MCP HTTP handler are real; there is no desktop host.
server[registerViews]({
  notes: { kind: "inline", js: "", css: "" },
  "note-file": { kind: "inline", js: "", css: "" },
});
const createdFiles: string[] = [];

afterAll(async () => {
  await server.close();
  await Promise.all(createdFiles.map((path) => rm(path, { force: true })));
});

async function request(
  method: string,
  params: Record<string, unknown> = {},
  meta: Record<string, unknown> = {}
) {
  const name =
    typeof params.name === "string"
      ? params.name
      : typeof params.uri === "string"
        ? params.uri
        : undefined;
  const response = await server.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(name !== undefined && { "mcp-name": name }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            ...meta,
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "notes-wire-test",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {
              extensions: {
                "io.modelcontextprotocol/ui": {
                  mimeTypes: ["text/html;profile=mcp-app"],
                },
              },
            },
          },
        },
      }),
    })
  );
  expect(response.status).toBe(200);
  const body = await response.text();
  const data = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? body
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : body;
  const envelope = JSON.parse(data ?? "{}");
  expect(envelope.error).toBeUndefined();
  return envelope.result;
}

describe("Markdown Notes through the real MCP HTTP handler", () => {
  it("advertises a global catalog and app-visible composer search", async () => {
    const { tools } = await request("tools/list");
    const catalog = tools.find(
      (tool: { name: string }) => tool.name === "open-notes"
    );
    expect(catalog._meta["openai/ui"].entrypoints).toEqual([
      { type: "global" },
    ]);
    const mentions = tools.find(
      (tool: { name: string }) => tool.name === "search-notes"
    );
    expect(mentions._meta["openai/extensions"]["mentions/search"]).toEqual({});
    expect(mentions._meta.ui.visibility).toEqual(["app"]);
    expect(mentions.annotations.readOnlyHint).toBe(true);
    expect(mentions._meta.ui.resourceUri).toBeUndefined();
    const file = tools.find(
      (tool: { name: string }) => tool.name === "open-note-file"
    );
    expect(file._meta["openai/ui"].entrypoints).toEqual([
      { type: "file", extensions: [".md", ".txt"] },
    ]);
    const check = tools.find(
      (tool: { name: string }) => tool.name === "check-demo-file"
    );
    expect(check._meta.ui.visibility).toEqual(["app"]);
  });

  it("preserves the opaque file identity without exposing an execution-host path", async () => {
    const file = {
      name: "demo.txt",
      resourceUri: "host-resource://opaque/%2F?identity=1",
    };
    const result = await request("tools/call", {
      name: "open-note-file",
      arguments: { file },
    });
    expect(result.structuredContent).toEqual({ file });
    expect(result._meta.ui.resourceUri).toBe("ui://views/note-file.html");
  });

  it("opens the actual catalog with the expected View resource", async () => {
    const result = await request("tools/call", {
      name: "open-notes",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.notes).toHaveLength(3);
    expect(result._meta.ui.resourceUri).toBe("ui://views/notes.html");
  });

  it("resolves every empty-query mention to its actual Markdown resource", async () => {
    const result = await request("tools/call", {
      name: "search-notes",
      arguments: { query: "" },
    });
    expect(result.content).toEqual([]);
    expect(result.structuredContent.items).toHaveLength(3);
    for (const link of result.structuredContent.items) {
      expect(link.type).toBe("resource_link");
      const resource = await request("resources/read", { uri: link.uri });
      expect(resource.contents).toEqual([
        {
          uri: link.uri,
          mimeType: "text/markdown",
          text: findNote(link.name).content,
        },
      ]);
    }
  });

  it("supports typeahead and no-match queries without paths or View metadata", async () => {
    const typed = await request("tools/call", {
      name: "search-notes",
      arguments: { query: "pack" },
    });
    expect(
      typed.structuredContent.items.map((item: { name: string }) => item.name)
    ).toEqual(["packing-list"]);
    expect(typed._meta?.ui?.resourceUri).toBeUndefined();
    const empty = await request("tools/call", {
      name: "search-notes",
      arguments: { query: "no-such-note" },
    });
    expect(empty.structuredContent.items).toEqual([]);
  });

  it("returns a bounded absolute host path to a newly created demo copy", async () => {
    const result = await request("tools/call", {
      name: "create-demo-file",
      arguments: { noteId: "packing-list" },
    });
    expect(result.isError).not.toBe(true);
    const { path, name } = result.structuredContent;
    createdFiles.push(path);
    expect(isAbsolute(path)).toBe(true);
    expect(path).toBe(resolve(process.cwd(), ".mcp-use", "notes-demo", name));
    expect(await readFile(path, "utf8")).toBe(findNote("packing-list").content);
  });

  it("rejects traversal identifiers through the tool's actual input schema", async () => {
    const result = await request("tools/call", {
      name: "create-demo-file",
      arguments: { noteId: "../../outside" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.path).toBeUndefined();
  });

  it("checks mocked host-injected paths on the server and rejects outside files and symlinks", async () => {
    const created = await request("tools/call", {
      name: "create-demo-file",
      arguments: { noteId: "welcome" },
    });
    const path: string = created.structuredContent.path;
    createdFiles.push(path);
    const params = { name: "check-demo-file", arguments: {} };
    // Mocked host metadata: the real request-scoped accessor and filesystem checks run.
    const allowed = await request("tools/call", params, {
      "openai/resource": { path },
    });
    expect(allowed.structuredContent.allowed).toBe(true);
    expect(JSON.stringify(allowed)).not.toContain(path);
    const link = `${path}.linked.md`;
    await symlink(path, link);
    createdFiles.push(link);
    for (const meta of [
      {},
      { "openai/resource": { path: "/tmp/outside.md" } },
      { "openai/resource": { path: link } },
    ]) {
      const rejected = await request("tools/call", params, meta);
      expect(rejected.structuredContent.allowed).toBe(false);
    }
  });
});
