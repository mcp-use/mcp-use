/**
 * MCP Conformance Test Client (TypeScript / Node MCPClient)
 */

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { MCPClient } from "mcp-use";
import {
  handleElicitation,
  isAuthScenario,
  isScopeStepUpScenario,
  parseConformanceContext,
  runScenario,
  type ConformanceSession,
} from "./conformance-shared.js";
import { createOAuthRetryFetch } from "./oauth-retry-fetch.js";
import { probeAuthParams } from "mcp-use";
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
    ? await createHeadlessConformanceOAuthProvider({
        preRegistrationContext: parseConformanceContext(),
      })
    : undefined;

  if (authProvider) {
    serverConfig.authProvider = authProvider;

    if (isScopeStepUpScenario(scenario)) {
      // Do NOT pre-authenticate for scope-step-up: the first token must have
      // only the scope from the initial 401 (mcp:basic). Pre-auth would get
      // a token with all PRM scopes (mcp:basic mcp:write), so tools/call would
      // never get 403 and the client would never make a second auth request.
      // The OAuth retry fetch handles both 401 (initial) and 403 (escalation).
      serverConfig.fetch = createOAuthRetryFetch(
        fetch,
        serverUrl,
        authProvider,
        {
          max403Retries: scenario === "auth/scope-retry-limit" ? 3 : undefined,
        }
      );
    } else {
      // Pre-authenticate for other auth scenarios
      const { resourceMetadataUrl, scope } = await probeAuthParams(serverUrl);
      const authResult = await auth(authProvider, {
        serverUrl,
        resourceMetadataUrl,
        scope,
      });
      if (authResult === "REDIRECT") {
        const authCode = await authProvider.getAuthorizationCode();
        await auth(authProvider, {
          serverUrl,
          resourceMetadataUrl,
          scope,
          authorizationCode: authCode,
        });
      }
    }
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
