import { describe, it, expect } from "vitest";
import { encode as encodeToon } from "@toon-format/toon";
import type {
  ToolSchema,
  ResourceSchema,
} from "../../../src/generator/inspectServers.js";

describe("TOON serialization for schemas", () => {
  it("should produce more compact output than JSON for tool schemas", () => {
    const tools: ToolSchema[] = [
      {
        name: "get_weather",
        description: "Get current weather for a location",
        inputSchema: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name" },
            units: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["location"],
        },
      },
      {
        name: "search",
        description: "Search the web",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Result limit" },
          },
          required: ["query"],
        },
      },
    ];

    const jsonOutput = JSON.stringify(tools, null, 2);
    const toonOutput = encodeToon(tools);

    // TOON should be more compact
    expect(toonOutput.length).toBeLessThan(jsonOutput.length);

    // Verify token efficiency: TOON typically saves 30-60% tokens
    const savings =
      ((jsonOutput.length - toonOutput.length) / jsonOutput.length) * 100;
    expect(savings).toBeGreaterThan(10); // At least 10% savings
  });

  it("should produce more compact output than JSON for resource schemas", () => {
    const resources: ResourceSchema[] = [
      {
        name: "config",
        uri: "file:///config.json",
        description: "Configuration file",
        mimeType: "application/json",
      },
      {
        name: "logs",
        uri: "file:///logs/app.log",
        description: "Application logs",
        mimeType: "text/plain",
      },
      {
        name: "data",
        uri: "file:///data.csv",
        description: "Data file",
        mimeType: "text/csv",
      },
    ];

    const jsonOutput = JSON.stringify(resources, null, 2);
    const toonOutput = encodeToon(resources);

    // TOON should be more compact
    expect(toonOutput.length).toBeLessThan(jsonOutput.length);

    // Verify token efficiency
    const savings =
      ((jsonOutput.length - toonOutput.length) / jsonOutput.length) * 100;
    expect(savings).toBeGreaterThan(10);
  });

  it("should format tool schemas in TOON with proper structure", () => {
    const tools: ToolSchema[] = [
      {
        name: "add",
        description: "Add two numbers",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "number" },
            b: { type: "number" },
          },
          required: ["a", "b"],
        },
      },
    ];

    const toonOutput = encodeToon(tools);

    // TOON output should be readable and structured
    expect(toonOutput).toBeTruthy();
    expect(toonOutput).toContain("add"); // Tool name should be present
    expect(toonOutput).not.toContain("{{"); // Should not have double braces
  });

  it("should format resource schemas in TOON with proper structure", () => {
    const resources: ResourceSchema[] = [
      {
        name: "users",
        uri: "postgres://localhost/users",
        description: "User database",
        mimeType: "application/x-postgresql",
      },
    ];

    const toonOutput = encodeToon(resources);

    // TOON output should be readable and structured
    expect(toonOutput).toBeTruthy();
    expect(toonOutput).toContain("users"); // Resource name should be present
  });

  it("should handle empty arrays gracefully", () => {
    const emptyTools: ToolSchema[] = [];
    const emptyResources: ResourceSchema[] = [];

    expect(() => encodeToon(emptyTools)).not.toThrow();
    expect(() => encodeToon(emptyResources)).not.toThrow();

    const toonTools = encodeToon(emptyTools);
    const toonResources = encodeToon(emptyResources);

    expect(toonTools).toBeTruthy();
    expect(toonResources).toBeTruthy();
  });
});
