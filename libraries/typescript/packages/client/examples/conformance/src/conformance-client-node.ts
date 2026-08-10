/**
 * MCP Conformance Test Client (TypeScript / Node MCPClient)
 */

import { auth } from "@modelcontextprotocol/client";
import { MCPClient } from "@mcp-use/client";
import {
  conformanceClientOptions,
  handleElicitation,
  handleSampling,
  isAuthScenario,
  parseConformanceContext,
  parsePreRegistrationContext,
  requiresOAuthRetryFetch,
  runScenario,
  runWithScenarioTimeout,
  type ConformanceSession,
} from "./conformance-shared.js";
import { createOAuthRetryFetch } from "./oauth-retry-fetch.js";
import { createHeadlessConformanceOAuthProvider } from "./headless-oauth-provider.js";

async function main(): Promise<void> {
  const serverUrl = process.argv[2];
  if (!serverUrl) {
    console.error("Usage: npx tsx src/conformance-client-node.ts <server_url>");
    process.exit(1);
  }

  const scenario = process.env.MCP_CONFORMANCE_SCENARIO || "";

  const serverConfig: Record<string, unknown> = {
    url: serverUrl,
    oauth: isAuthScenario(scenario) ? undefined : false,
    clientOptions: conformanceClientOptions(),
  };
  const authProvider = isAuthScenario(scenario)
    ? await createHeadlessConformanceOAuthProvider({
        preRegistrationContext: parsePreRegistrationContext(),
      })
    : undefined;

  if (authProvider) {
    serverConfig.authProvider = authProvider;

    if (requiresOAuthRetryFetch(scenario)) {
      // Preserve a scope advertised by the initial 401. Pre-authentication
      // cannot see WWW-Authenticate, so it would request an incomplete token.
      // The retry fetch handles the initial 401 and any later 403 escalation.
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
      const authResult = await auth(authProvider, {
        serverUrl,
      });
      if (authResult === "REDIRECT") {
        const { code, iss } = await authProvider.getAuthorizationResponse();
        await auth(authProvider, {
          serverUrl,
          authorizationCode: code,
          ...(iss !== undefined && { iss }),
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
      onElicitation: handleElicitation,
      onSampling: handleSampling,
    }
  );

  try {
    const session = await client.createSession("test");
    const conformanceSession: ConformanceSession = {
      listTools: () => session.listTools(),
      callTool: (name, args) => session.callTool(name, args),
      listResources: async () => (await session.listResources()).resources,
      readResource: (uri) => session.readResource(uri),
      listPrompts: async () => (await session.listPrompts()).prompts,
      getPrompt: (name, args) => session.getPrompt(name, args),
    };
    await runScenario(scenario, conformanceSession, parseConformanceContext());
  } finally {
    await client.closeAllSessions();
  }
}

runWithScenarioTimeout(
  process.env.MCP_CONFORMANCE_SCENARIO || "",
  main()
).catch((err) => {
  console.error(err);
  process.exit(1);
});
