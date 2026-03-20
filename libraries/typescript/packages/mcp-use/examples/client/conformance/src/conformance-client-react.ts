/**
 * MCP Conformance Test Client (TypeScript / React hooks path)
 *
 * This runner intentionally exercises React integration primitives:
 * - McpClientProvider
 * - useMcpClient
 */

import React, { useEffect, useRef } from "react";
import { JSDOM } from "jsdom";
import { McpClientProvider, useMcpClient } from "mcp-use/react";
import TestRenderer, { act } from "react-test-renderer";
import {
  handleElicitation,
  isAuthScenario,
  isScopeStepUpScenario,
  parseConformanceContext,
  runScenario,
  type ConformanceSession,
} from "./conformance-shared.js";
import { createOAuthRetryFetch } from "./oauth-retry-fetch.js";
import { createHeadlessConformanceOAuthProvider } from "./headless-oauth-provider.js";

type DriverProps = {
  scenario: string;
  resolve: () => void;
  reject: (error: Error) => void;
};

function ScenarioDriver({ scenario, resolve, reject }: DriverProps): null {
  const { servers, storageLoaded } = useMcpClient();
  const doneRef = useRef(false);
  const scenarioStartedRef = useRef(false);
  const handledElicitationIdsRef = useRef<Set<string>>(new Set());
  const authTriggeredRef = useRef(false);

  useEffect(() => {
    if (!storageLoaded || doneRef.current) return;

    const interval = setInterval(() => {
      if (doneRef.current) return;
      const server = servers.find((s) => s.id === "test");
      if (!server) return;

      for (const pending of server.pendingElicitationRequests) {
        if (handledElicitationIdsRef.current.has(pending.id)) continue;
        handledElicitationIdsRef.current.add(pending.id);
        handleElicitation(pending.request as any)
          .then((result) => server.approveElicitation(pending.id, result))
          .catch((error) =>
            server.rejectElicitation(
              pending.id,
              error instanceof Error ? error.message : String(error)
            )
          );
      }
    }, 25);

    return () => clearInterval(interval);
  }, [servers, storageLoaded]);

  useEffect(() => {
    if (!storageLoaded || doneRef.current) return;
    const server = servers.find((s) => s.id === "test");
    if (!server) return;
    if (
      isAuthScenario(scenario) &&
      server.state === "pending_auth" &&
      !authTriggeredRef.current
    ) {
      authTriggeredRef.current = true;
      server.authenticate().catch((err) => {
        doneRef.current = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    }
  }, [servers, storageLoaded, scenario, reject]);

  useEffect(() => {
    if (!storageLoaded || doneRef.current) return;

    const server = servers.find((s) => s.id === "test");
    if (!server) return;

    if (server.state === "failed") {
      doneRef.current = true;
      reject(new Error(server.error || "React MCP server connection failed"));
      return;
    }

    if (server.state !== "ready" || scenarioStartedRef.current) return;

    scenarioStartedRef.current = true;
    const conformanceSession: ConformanceSession = {
      listTools: async () => server.tools as any[],
      callTool: (name, args) => server.callTool(name, args),
    };

    runScenario(scenario, conformanceSession)
      .then(() => {
        doneRef.current = true;
        resolve();
      })
      .catch((error) => {
        doneRef.current = true;
        reject(error);
      });
  }, [servers, storageLoaded, scenario, resolve, reject]);

  return null;
}

function setupReactRuntimeDom(): () => void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost:3000/",
  });

  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  (globalThis as any).localStorage = dom.window.localStorage;
  (globalThis as any).sessionStorage = dom.window.sessionStorage;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  return () => {
    dom.window.close();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).navigator;
    delete (globalThis as any).localStorage;
    delete (globalThis as any).sessionStorage;
  };
}

async function main(): Promise<void> {
  const serverUrl = process.argv[2];
  if (!serverUrl) {
    console.error(
      "Usage: npx tsx src/conformance-client-react.ts <server_url>"
    );
    process.exit(1);
  }

  const scenario = process.env.MCP_CONFORMANCE_SCENARIO || "";
  const teardownDom = setupReactRuntimeDom();
  const authProvider = isAuthScenario(scenario)
    ? await createHeadlessConformanceOAuthProvider({
        preRegistrationContext: parseConformanceContext(),
      })
    : undefined;
  // For scope-step-up we do not pre-auth; the OAuth retry fetch obtains the
  // first token from the initial 401 so it has only mcp:basic, then handles 403.
  const mcpServers: Record<string, any> = {
    test: {
      name: "test",
      url: serverUrl,
      authProvider,
      ...(authProvider &&
        isScopeStepUpScenario(scenario) && {
          fetch: createOAuthRetryFetch(fetch, serverUrl, authProvider, {
            max403Retries:
              scenario === "auth/scope-retry-limit" ? 3 : undefined,
          }),
        }),
      // Disable health-check driven reconnects in conformance runs:
      // some scenarios keep long-lived requests open and do not handle HEAD probes.
      autoReconnect: false,
      autoRetry: false,
      // Allow automatic OAuth flow in conformance tests (headless provider)
      preventAutoAuth: false,
    },
  };
  try {
    await new Promise<void>((resolve, reject) => {
      let renderer: TestRenderer.ReactTestRenderer | null = null;
      const finish = () => {
        try {
          renderer?.unmount();
        } catch {
          // no-op
        }
        resolve();
      };
      const fail = (error: Error) => {
        try {
          renderer?.unmount();
        } catch {
          // no-op
        }
        reject(error);
      };

      act(() => {
        renderer = TestRenderer.create(
          React.createElement(McpClientProvider, {
            mcpServers,
            children: React.createElement(ScenarioDriver, {
              scenario,
              resolve: finish,
              reject: fail,
            }),
          })
        );
      });
    });
  } finally {
    teardownDom();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
