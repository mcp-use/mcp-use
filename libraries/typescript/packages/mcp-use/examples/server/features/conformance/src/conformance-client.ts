/**
 * MCP Conformance Test Client (TypeScript)
 *
 * A client that exercises MCP protocol features for conformance testing.
 * Uses MCPClient for all scenarios to validate the mcp-use client SDK.
 *
 * The conformance test framework starts a test server and passes its URL as argv[2].
 * The scenario name is in the MCP_CONFORMANCE_SCENARIO env var.
 *
 * Usage: npx tsx src/conformance-client.ts <server_url>
 */

import { MCPClient } from "mcp-use";
import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from "mcp-use";

// =============================================================================
// Elicitation callback — apply schema defaults
// =============================================================================

async function handleElicitation(
  params: ElicitRequestFormParams | ElicitRequestURLParams
): Promise<ElicitResult> {
  const content: Record<string, unknown> = {};

  if ("requestedSchema" in params && params.requestedSchema) {
    const schema = params.requestedSchema as Record<string, any>;
    const properties = schema.properties || {};
    for (const [fieldName, fieldSchema] of Object.entries(properties)) {
      const fs = fieldSchema as Record<string, any>;
      if (fs && "default" in fs) {
        content[fieldName] = fs.default;
      }
    }
  }

  return { action: "accept", content } as ElicitResult;
}

// =============================================================================
// Scenario handlers
// =============================================================================

async function runToolsCall(session: any): Promise<void> {
  const tools = await session.listTools();
  for (const tool of tools) {
    const args: Record<string, any> = {};
    const schema = tool.inputSchema || {};
    const properties = schema.properties || {};
    for (const [paramName, paramSchema] of Object.entries(properties)) {
      const ps = paramSchema as Record<string, any>;
      const paramType = ps.type || "string";
      if (paramType === "number" || paramType === "integer") {
        args[paramName] = 1;
      } else if (paramType === "boolean") {
        args[paramName] = true;
      } else {
        args[paramName] = "test";
      }
    }
    try {
      await session.callTool(tool.name, args);
    } catch {
      // Some tools may intentionally error
    }
  }
}

async function runElicitationDefaults(session: any): Promise<void> {
  const tools = await session.listTools();
  for (const tool of tools) {
    if (!(tool.name || "").toLowerCase().includes("elicit")) continue;
    try {
      await session.callTool(tool.name, {});
    } catch {
      // Expected for some tools
    }
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const serverUrl = process.argv[2];
  if (!serverUrl) {
    console.error("Usage: npx tsx src/conformance-client.ts <server_url>");
    process.exit(1);
  }

  const scenario = process.env.MCP_CONFORMANCE_SCENARIO || "";

  const client = new MCPClient(
    {
      mcpServers: {
        test: { url: serverUrl },
      },
    },
    {
      elicitationCallback: handleElicitation,
    }
  );

  try {
    const session = await client.createSession("test");
    if (!session) {
      console.error("Failed to create session");
      process.exit(1);
    }

    switch (scenario) {
      case "initialize":
        break;
      case "tools_call":
        await runToolsCall(session);
        break;
      case "elicitation-sep1034-client-defaults":
        await runElicitationDefaults(session);
        break;
      case "sse-retry":
        await new Promise((resolve) => setTimeout(resolve, 5000));
        break;
      default:
        await runToolsCall(session);
        break;
    }
  } finally {
    await client.closeAllSessions();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
