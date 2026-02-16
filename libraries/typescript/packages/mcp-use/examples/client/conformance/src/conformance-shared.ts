import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import { acceptWithDefaults } from "mcp-use";

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
      if (isAuthScenario(scenario)) {
        // OAuth exchange is validated by the conformance harness during session creation.
        return;
      }
      await runToolsCall(session);
  }
}
