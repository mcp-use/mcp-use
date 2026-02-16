/**
 * MCP Conformance Test Client (TypeScript / BrowserMCPClient path)
 */

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { MCPClient as BrowserMCPClient } from "mcp-use/browser";
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
    serverConfig.authProvider = authProvider;

    if (isScopeStepUpScenario(scenario)) {
      // Do not pre-authenticate for scope-step-up so the first token has only
      // the scope from the initial 401; the OAuth retry fetch handles 401 and 403.
      serverConfig.fetch = createOAuthRetryFetch(
        fetch,
        serverUrl,
        authProvider,
        {
          max403Retries: scenario === "auth/scope-retry-limit" ? 3 : undefined,
        }
      );
    } else {
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
