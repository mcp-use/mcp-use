/**
 * MCP Conformance Test Client (TypeScript / Node MCPClient)
 */

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
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
  const authProvider = isAuthScenario(scenario)
    ? createHeadlessConformanceOAuthProvider()
    : undefined;

  if (authProvider) {
    // Pre-authenticate using SDK's auth() function
    // Step 1: Trigger OAuth discovery and redirectToAuthorization
    const authResult = await auth(authProvider, {
      serverUrl,
    });

    if (authResult === "REDIRECT") {
      // Step 2: Get the authorization code that was captured
      const authCode = await authProvider.getAuthorizationCode();

      // Step 3: Exchange code for tokens
      await auth(authProvider, {
        serverUrl,
        authorizationCode: authCode,
      });
    }

    serverConfig.authProvider = authProvider;
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
