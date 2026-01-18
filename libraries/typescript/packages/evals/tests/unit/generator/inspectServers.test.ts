import { describe, expect, it } from "vitest";
import { mapResource, mapTool } from "../../../src/generator/inspectServers.js";

describe("inspectServers mapping helpers", () => {
  it("maps tool schemas with required fields", () => {
    const tool = {
      name: "add",
      description: "Add numbers",
      inputSchema: { type: "object", properties: { a: { type: "number" } } },
    };

    expect(mapTool(tool as any)).toEqual({
      name: "add",
      description: "Add numbers",
      inputSchema: tool.inputSchema,
    });
  });

  it("maps resource schemas with optional metadata", () => {
    const resource = {
      name: "hello",
      uri: "resource://hello",
      description: "Hello resource",
      mimeType: "text/plain",
    };

    expect(mapResource(resource)).toEqual(resource);
  });
});
