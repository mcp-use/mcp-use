/**
 * MCP Conformance Test Client (TypeScript / BrowserMCPClient path)
 */

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { MCPClient as BrowserMCPClient } from "mcp-use/browser";
import {
  handleElicitation,
  isAuthScenario,
  parseConformanceContext,
  runScenario,
  type ConformanceSession,
} from "./conformance-shared.js";
import { probeAuthParams } from "mcp-use";
import { createHeadlessConformanceOAuthProvider } from "./headless-oauth-provider.js";

async function main(): Promise<void> {
  const serverUrl = process.argv[2];
  if (!serverUrl) {
    console.error(
      "Usage: npx tsx src/conformance-client-browser.ts <server_url>"
    );
    process.exit(1);
  }

  const scenario = process.env.MCP_CONFORMANCE_SCENARIO || "";
  const serverConfig: Record<string, unknown> = {
    url: serverUrl,
    elicitationCallback: handleElicitation,
  };

  const authProvider = isAuthScenario(scenario)
    ? await createHeadlessConformanceOAuthProvider({
        preRegistrationContext: parseConformanceContext(),
      })
    : undefined;

  if (authProvider) {
    // Probe for WWW-Authenticate params (scope, resource_metadata) from 401
    const { resourceMetadataUrl, scope } = await probeAuthParams(serverUrl);

    // Pre-authenticate using SDK's auth() function
    // Step 1: Trigger OAuth discovery and redirectToAuthorization
    const authResult = await auth(authProvider, {
      serverUrl,
      resourceMetadataUrl,
      scope,
    });

    if (authResult === "REDIRECT") {
      // Step 2: Get the authorization code that was captured
      const authCode = await authProvider.getAuthorizationCode();

      // Step 3: Exchange code for tokens
      await auth(authProvider, {
        serverUrl,
        resourceMetadataUrl,
        scope,
        authorizationCode: authCode,
      });
    }

    serverConfig.authProvider = authProvider;
  }

  const client = new BrowserMCPClient({
    mcpServers: { test: serverConfig },
  });

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
