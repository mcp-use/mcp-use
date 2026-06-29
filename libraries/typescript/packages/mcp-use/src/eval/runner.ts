import { MCPClient } from "../client.js";
import type { EvalAssertion, EvalCase, EvalSpec } from "./schema.js";

export type EvalRunner = "local" | "cloud" | "chatgpt";
export type EvalStatus = "passed" | "failed" | "skipped";

export interface EvalAssertionResult {
  assertion: EvalAssertion;
  passed: boolean;
  message?: string;
}

export interface EvalTestResult {
  name: string;
  type: EvalCase["type"];
  status: EvalStatus;
  durationMs: number;
  actualStatus?: "ok" | "error";
  actualText?: string;
  error?: string;
  assertions: EvalAssertionResult[];
}

export interface EvalSpecResult {
  name: string;
  runner: EvalRunner;
  server?: string;
  status: EvalStatus;
  tests: EvalTestResult[];
  error?: string;
}

export interface EvalReport {
  apiVersion: "mcp-use.dev/eval-report/v1";
  runner: EvalRunner;
  status: EvalStatus;
  startedAt: string;
  endedAt: string;
  summary: {
    specs: number;
    tests: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  specs: EvalSpecResult[];
  outputPath?: string;
}

interface EvalSessionLike {
  listTools(options?: unknown): Promise<unknown>;
  callTool(
    name: string,
    args?: Record<string, unknown>,
    options?: unknown
  ): Promise<unknown>;
  listResources?(cursor?: string, options?: unknown): Promise<unknown>;
  readResource?(uri: string, options?: unknown): Promise<unknown>;
  listPrompts?(): Promise<unknown>;
  getPrompt?(name: string, args: Record<string, unknown>): Promise<unknown>;
  request?(
    method: string,
    params?: Record<string, unknown> | null,
    options?: unknown
  ): Promise<unknown>;
}

interface EvalClientLike {
  createAllSessions(): Promise<unknown>;
  getServerNames(): string[];
  getSession(name: string): EvalSessionLike | null;
  close?(): Promise<void>;
  closeAllSessions?(): Promise<void>;
}

export type EvalClientFactory = (
  mcpServers: Record<string, Record<string, unknown>>
) => EvalClientLike;

export interface RunEvalOptions {
  runner?: EvalRunner;
  now?: () => Date;
  createClient?: EvalClientFactory;
  outputPath?: string;
}

function defaultCreateClient(
  mcpServers: Record<string, Record<string, unknown>>
): EvalClientLike {
  return new MCPClient({ mcpServers });
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const chunks: string[] = [];

    if (Array.isArray(record.content)) {
      for (const item of record.content) {
        if (item && typeof item === "object" && "text" in item) {
          chunks.push(String((item as { text?: unknown }).text ?? ""));
        } else {
          chunks.push(JSON.stringify(item));
        }
      }
    }

    if (record.structuredContent !== undefined) {
      chunks.push(JSON.stringify(record.structuredContent));
    }

    if (chunks.length > 0) return chunks.join("\n");
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isToolError(result: unknown): boolean {
  return (
    !!result &&
    typeof result === "object" &&
    (result as { isError?: unknown }).isError === true
  );
}

function assertionLabel(assertion: EvalAssertion): string {
  switch (assertion.type) {
    case "status":
      return `status equals ${assertion.equals}`;
    case "content_contains":
      return `content contains ${JSON.stringify(assertion.value)}`;
    case "content_regex":
      return `content matches /${assertion.pattern}/`;
    default:
      return "unknown assertion";
  }
}

function evaluateAssertion(
  assertion: EvalAssertion,
  actualStatus: "ok" | "error",
  actualText: string
): EvalAssertionResult {
  if (assertion.type === "status") {
    const passed = actualStatus === assertion.equals;
    return {
      assertion,
      passed,
      message: passed
        ? undefined
        : `Expected ${assertionLabel(assertion)}, got ${actualStatus}.`,
    };
  }

  if (assertion.type === "content_contains") {
    const passed = actualText.includes(assertion.value);
    return {
      assertion,
      passed,
      message: passed ? undefined : `Expected ${assertionLabel(assertion)}.`,
    };
  }

  const passed = new RegExp(assertion.pattern).test(actualText);
  return {
    assertion,
    passed,
    message: passed ? undefined : `Expected ${assertionLabel(assertion)}.`,
  };
}

function getStringParam(
  params: Record<string, unknown> | undefined,
  name: string
): string {
  const value = params?.[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`protocol test requires params.${name}`);
  }
  return value;
}

function getObjectParam(
  params: Record<string, unknown> | undefined,
  name: string
): Record<string, unknown> | undefined {
  const value = params?.[name];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function requireProtocolMethod<T>(
  method: T | undefined,
  protocolMethod: string
): T {
  if (!method) {
    throw new Error(`protocol method ${protocolMethod} is not supported`);
  }
  return method;
}

async function executeProtocolTest(
  session: EvalSessionLike,
  test: Extract<EvalCase, { type: "protocol" }>
): Promise<unknown> {
  const params = test.params;

  switch (test.method) {
    case "tools/list":
      return session.listTools();
    case "tools/call": {
      const name = getStringParam(params, "name");
      const args =
        getObjectParam(params, "arguments") ?? getObjectParam(params, "input");
      return session.callTool(name, args ?? {});
    }
    case "resources/list":
      return requireProtocolMethod(session.listResources, test.method).call(
        session,
        params?.cursor as string | undefined
      );
    case "resources/read":
      return requireProtocolMethod(session.readResource, test.method).call(
        session,
        getStringParam(params, "uri")
      );
    case "prompts/list":
      return requireProtocolMethod(session.listPrompts, test.method).call(
        session
      );
    case "prompts/get":
      return requireProtocolMethod(session.getPrompt, test.method).call(
        session,
        getStringParam(params, "name"),
        getObjectParam(params, "arguments") ?? {}
      );
    default:
      if (!session.request) {
        throw new Error(
          `protocol method ${test.method} is not supported by this session`
        );
      }
      return session.request(test.method, params ?? {});
  }
}

async function executeTest(
  session: EvalSessionLike,
  test: EvalCase
): Promise<unknown> {
  if (test.type === "tool") {
    return session.callTool(test.tool, test.input);
  }

  if (test.type === "protocol") {
    return executeProtocolTest(session, test);
  }

  throw new Error(
    "conversation evals are not implemented in the local runner yet"
  );
}

async function runTest(
  session: EvalSessionLike,
  test: EvalCase
): Promise<EvalTestResult> {
  const started = Date.now();
  let actualStatus: "ok" | "error" = "ok";
  let actualText = "";
  let error: string | undefined;

  try {
    const result = await executeTest(session, test);
    actualStatus = isToolError(result) ? "error" : "ok";
    actualText = textFromUnknown(result);
  } catch (err) {
    actualStatus = "error";
    error = errorMessage(err);
    actualText = error;
  }

  const assertions =
    test.expect.length > 0
      ? test.expect
      : ([{ type: "status", equals: "ok" }] as EvalAssertion[]);
  const assertionResults = assertions.map((assertion) =>
    evaluateAssertion(assertion, actualStatus, actualText)
  );
  const passed = assertionResults.every((assertion) => assertion.passed);

  return {
    name: test.name,
    type: test.type,
    status: passed ? "passed" : "failed",
    durationMs: Date.now() - started,
    actualStatus,
    actualText,
    error,
    assertions: assertionResults,
  };
}

function resolveSpecServerName(spec: EvalSpec, client: EvalClientLike): string {
  const serverNames = client.getServerNames();
  if (spec.server) {
    if (!serverNames.includes(spec.server)) {
      throw new Error(
        `Eval spec "${spec.name}" references server "${spec.server}", but only ${
          serverNames.join(", ") || "no servers"
        } are configured.`
      );
    }
    return spec.server;
  }

  const first = serverNames[0];
  if (!first) {
    throw new Error(`Eval spec "${spec.name}" does not configure mcpServers.`);
  }
  return first;
}

async function closeClient(client: EvalClientLike): Promise<void> {
  if (client.close) {
    await client.close();
    return;
  }
  if (client.closeAllSessions) {
    await client.closeAllSessions();
  }
}

async function runLocalSpec(
  spec: EvalSpec,
  createClient: EvalClientFactory
): Promise<EvalSpecResult> {
  if (!spec.mcpServers || Object.keys(spec.mcpServers).length === 0) {
    return {
      name: spec.name,
      runner: "local",
      status: "failed",
      tests: [],
      error:
        "Local evals need top-level mcpServers in the spec so MCPClient can connect.",
    };
  }

  const client = createClient(spec.mcpServers);
  try {
    await client.createAllSessions();
    const serverName = resolveSpecServerName(spec, client);
    const session = client.getSession(serverName);
    if (!session) {
      throw new Error(`No active session for server "${serverName}".`);
    }

    const tests: EvalTestResult[] = [];
    for (const test of spec.tests) {
      tests.push(await runTest(session, test));
    }

    return {
      name: spec.name,
      runner: "local",
      server: serverName,
      status: tests.some((test) => test.status === "failed")
        ? "failed"
        : "passed",
      tests,
    };
  } catch (err) {
    return {
      name: spec.name,
      runner: "local",
      status: "failed",
      tests: [],
      error: errorMessage(err),
    };
  } finally {
    await closeClient(client);
  }
}

export async function runEvalSpecs(
  specs: EvalSpec[],
  options: RunEvalOptions = {}
): Promise<EvalReport> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runner = options.runner ?? "local";

  if (runner === "cloud" || runner === "chatgpt") {
    throw new Error(
      `${runner} eval runner is not implemented in this CLI yet. Use --runner local for deterministic protocol/tool evals.`
    );
  }

  const createClient = options.createClient ?? defaultCreateClient;
  const specResults: EvalSpecResult[] = [];
  for (const spec of specs) {
    specResults.push(await runLocalSpec(spec, createClient));
  }

  const tests = specResults.flatMap((spec) => spec.tests);
  const failed =
    tests.filter((test) => test.status === "failed").length +
    specResults.filter((spec) => spec.error).length;
  const skipped = tests.filter((test) => test.status === "skipped").length;
  const passed = tests.filter((test) => test.status === "passed").length;
  const endedAt = now().toISOString();

  return {
    apiVersion: "mcp-use.dev/eval-report/v1",
    runner,
    status: failed > 0 ? "failed" : "passed",
    startedAt,
    endedAt,
    summary: {
      specs: specResults.length,
      tests: tests.length,
      passed,
      failed,
      skipped,
    },
    specs: specResults,
    outputPath: options.outputPath,
  };
}
