import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSuite } from "../src/runSuite.js";
import { scaffoldTemplateServer, type TemplateName } from "./helpers/scaffoldTemplateServer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(__dirname, "..", "examples", "templates");

const templates: TemplateName[] = ["blank", "starter", "mcp-apps"];

describe("template verification (create-mcp-use-app)", () => {
  for (const template of templates) {
    it(`passes deterministic checks for ${template} template`, async () => {
      const server = await scaffoldTemplateServer(template);
      try {
        process.env.MCP_SERVER_URL = server.mcpUrl;
        const suitePath = path.join(examplesDir, `${template}.suite.yaml`);
        const result = await runSuite({
          suitePath,
          serverUrl: server.mcpUrl,
          skipAgent: true,
        });
        if (!result.passed) {
          console.error(result.reportMd);
        }
        expect(result.passed).toBe(true);
        expect(result.checkResults.length).toBeGreaterThan(0);
        expect(result.checkResults.every((c) => c.passed)).toBe(true);
      } finally {
        await server.cleanup();
      }
    }, 300_000);
  }

  it("mcp-apps agent + widget screenshot scenario when OPENROUTER_API_KEY is set", async () => {
    if (!process.env.OPENROUTER_API_KEY) {
      console.warn("Skipping agent/widget test — OPENROUTER_API_KEY not set");
      return;
    }

    const server = await scaffoldTemplateServer("mcp-apps");
    try {
      const suitePath = path.join(examplesDir, "mcp-apps.suite.yaml");
      const result = await runSuite({
        suitePath,
        serverUrl: server.mcpUrl,
        clients: ["mcp-use"],
        skipAgent: false,
      });
      if (!result.passed) {
        console.error(result.reportMd);
      }
      expect(result.scenarioResults.length).toBeGreaterThan(0);
      expect(result.passed).toBe(true);
    } finally {
      await server.cleanup();
    }
  }, 600_000);
});
