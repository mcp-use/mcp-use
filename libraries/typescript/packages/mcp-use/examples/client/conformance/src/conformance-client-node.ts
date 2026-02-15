/**
 * MCP Conformance Test Client (TypeScript / Node MCPClient)
 */

import { MCPClient } from "mcp-use";
import {
  handleElicitation,
  isAuthScenario,
  runScenario,
  type ConformanceSession,
} from "./conformance-shared.js";
import { createHeadlessConformanceOAuthProvider } from "./headless-oauth-provider.js";

async function main(): Promise<void> {
  const serverUrl = process.argv[2];
  if (!serverUrl) {
    console.error("Usage: npx tsx src/conformance-client-node.ts <server_url>");
    process.exit(1);
  }

  const scenario = process.env.MCP_CONFORMANCE_SCENARIO || "";

  const serverConfig: Record<string, unknown> = { url: serverUrl };
  if (isAuthScenario(scenario)) {
    serverConfig.authProvider = createHeadlessConformanceOAuthProvider();
  }

  const client = new MCPClient(
    {
      mcpServers: {
        test: serverConfig,
      },
    },
    {
      elicitationCallback: handleElicitation,
    }
  );

  try {
    const session = await client.createSession("test");
    const conformanceSession: ConformanceSession = {
      listTools: () => session.listTools(),
      callTool: (name, args) => session.callTool(name, args),
    };
    await runScenario(scenario, conformanceSession);
  } finally {
    await client.closeAllSessions();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
