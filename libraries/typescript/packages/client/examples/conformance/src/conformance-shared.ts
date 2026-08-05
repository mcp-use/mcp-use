import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from "@modelcontextprotocol/client";
import { acceptWithDefaults } from "@mcp-use/client";

type Tool = {
  name: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
  };
};

export type ConformanceSession = {
  listTools: () => Promise<Tool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

export type PreRegistrationContext = {
  client_id: string;
  client_secret: string;
};

export function parseConformanceContext():
  | ({ name: string } & PreRegistrationContext)
  | undefined {
  const raw = process.env.MCP_CONFORMANCE_CONTEXT;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.name === "auth/pre-registration" &&
      parsed.client_id &&
      parsed.client_secret
    ) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function isAuthScenario(scenario: string): boolean {
  return scenario.startsWith("auth/");
}

/** Scenarios that require listTools + callTool so server can return 403 and client can do scope escalation. */
export function isScopeStepUpScenario(scenario: string): boolean {
  return (
    scenario === "auth/scope-step-up" || scenario === "auth/scope-retry-limit"
  );
}

/**
 * Scenarios whose initial 401 carries the requested OAuth scope in
 * WWW-Authenticate. They must let the retry fetch observe that response;
 * pre-authenticating would lose the scope before the first MCP request.
 */
export function requiresOAuthRetryFetch(scenario: string): boolean {
  return (
    isScopeStepUpScenario(scenario) ||
    scenario === "auth/scope-from-www-authenticate"
  );
}

const CONFORMANCE_SCENARIO_TIMEOUT_MS = 45_000;

/**
 * Keep a broken fixture from consuming the workflow-level timeout. The process
 * exits after this rejects, so a still-pending connection cannot keep CI alive.
 */
export async function runWithScenarioTimeout<T>(
  scenario: string,
  run: Promise<T>,
  timeoutMs = CONFORMANCE_SCENARIO_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Conformance scenario ${scenario || "unknown"} exceeded ${timeoutMs}ms`
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([run, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function handleElicitation(
  params: ElicitRequestFormParams | ElicitRequestURLParams
): Promise<ElicitResult> {
  return acceptWithDefaults(params);
}

function buildToolArgs(tool: Tool): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const properties = tool.inputSchema?.properties || {};

  for (const [paramName, paramSchema] of Object.entries(properties)) {
    const schema = paramSchema as Record<string, unknown>;
    const paramType = schema.type || "string";
    if (paramType === "number" || paramType === "integer") {
      args[paramName] = 1;
    } else if (paramType === "boolean") {
      args[paramName] = true;
    } else {
      args[paramName] = "test";
    }
  }

  return args;
}

export async function runToolsCall(session: ConformanceSession): Promise<void> {
  const tools = await session.listTools();
  for (const tool of tools) {
    const args = buildToolArgs(tool);
    try {
      await session.callTool(tool.name, args);
    } catch {
      // Some conformance tools intentionally return errors.
    }
  }
}

export async function runElicitationDefaults(
  session: ConformanceSession
): Promise<void> {
  const tools = await session.listTools();
  for (const tool of tools) {
    if (!(tool.name || "").toLowerCase().includes("elicit")) {
      continue;
    }
    try {
      await session.callTool(tool.name, {});
    } catch {
      // Some elicitation tools intentionally return errors.
    }
  }
}

export async function runScenario(
  scenario: string,
  session: ConformanceSession
): Promise<void> {
  switch (scenario) {
    case "initialize":
      return;
    case "tools_call":
    case "tools-call":
      await runToolsCall(session);
      return;
    case "elicitation-sep1034-client-defaults":
    case "elicitation-defaults":
      await runElicitationDefaults(session);
      return;
    case "sse-retry":
      await runToolsCall(session);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await runToolsCall(session);
      return;
    default:
      if (isScopeStepUpScenario(scenario)) {
        // Run listTools then callTool so server can return 403 on tools/call;
        // client must re-auth with escalated scope and retry (via OAuth retry fetch).
        await runToolsCall(session);
        return;
      }
      if (isAuthScenario(scenario)) {
        // OAuth exchange is validated by the conformance harness during session creation.
        return;
      }
      await runToolsCall(session);
  }
}
