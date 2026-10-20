import { createHash } from "node:crypto";

import { expect } from "vitest";

import { flush } from "../../src/index.js";
import type { AnalyticsEvent } from "../../src/types.js";
import type { MockIngest } from "./ingest.js";
import { byMethod, fakeConfigClock, only } from "./state.js";

/** The client methods every scenario uses (v1 and v2 `Client` both have them). */
export interface ScenarioClient {
  listTools(): Promise<unknown>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
  readResource(params: { uri: string }): Promise<unknown>;
  getPrompt(params: {
    name: string;
    arguments?: Record<string, string>;
  }): Promise<unknown>;
}

/** The fixture surface every test server registers. */
export const FIXTURE = {
  tools: {
    echo: "echo",
    fail: "fail",
    explode: "explode",
    unknown: "nope",
    slow: "slow",
  },
  resourceUri: "memo://note",
  prompt: "greet",
} as const;

/** How long the `slow` tool runs; it ignores cancellation, like most tools. */
export const SLOW_MS = 300;

let slowWaiters: Array<() => void> = [];

/** Body of the `slow` tool: wait {@link SLOW_MS}, then return. */
export async function slowTool(): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
  const waiters = slowWaiters;
  slowWaiters = [];
  // Resolve after the handler's own promise settles and the SDK handled it.
  setTimeout(() => {
    for (const resolve of waiters) resolve();
  }, 20);
  return "slow done";
}

/** Resolves shortly after the next `slow` tool call returned. */
export function slowReturned(): Promise<void> {
  return new Promise((resolve) => slowWaiters.push(resolve));
}

/** How long a client waits before cancelling the `slow` call. */
export const CANCEL_AFTER_MS = 60;

/**
 * Call the `slow` tool and cancel it after {@link CANCEL_AFTER_MS}, then wait
 * until its handler returned anyway.
 */
export async function callSlowAndCancel(
  call: (signal: AbortSignal) => Promise<unknown>
): Promise<void> {
  const returned = slowReturned();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("cancelled by the test client")),
    CANCEL_AFTER_MS
  );
  await expect(call(controller.signal)).rejects.toThrow();
  clearTimeout(timer);
  await returned;
}

/**
 * The cancelled `slow` call was recorded once, without an outcome or a
 * response, timed until the cancellation rather than until its handler
 * returned.
 */
export function expectCancelledSlowCall(events: AnalyticsEvent[]): void {
  const slow = only(
    events,
    (e) => e.method === "tools/call" && e.target === FIXTURE.tools.slow
  );
  expect(slow.outcome).toBeUndefined();
  expect(slow.error).toBeUndefined();
  expect(slow.response_size).toBeUndefined();
  expect(slow.response_payload).toBeUndefined();
  expect(slow.request_id).toBeDefined();
  expect(slow.duration_ms).toBeLessThan(SLOW_MS);
  // The ingest edge maps it like a gateway stream that closed before the
  // response, which needs an HTTP status below 400 (or none).
  expect(slow.http?.status ?? 200).toBeLessThan(400);
}

/**
 * Exercise every scenario: tools/list, a successful tool, an `isError` tool,
 * a throwing tool, an unknown tool, resources/read and prompts/get.
 */
export async function runScenarios(client: ScenarioClient): Promise<void> {
  await client.listTools();
  await client.callTool({
    name: FIXTURE.tools.echo,
    arguments: { text: "hi" },
  });
  await client.callTool({ name: FIXTURE.tools.fail, arguments: {} });
  // High-level servers turn a throw into an isError result; low-level ones
  // answer a JSON-RPC error, which the client throws.
  await client
    .callTool({ name: FIXTURE.tools.explode, arguments: {} })
    .catch(() => undefined);
  // Unknown tools are an isError result on SDK v1 and a JSON-RPC error on v2.
  await client
    .callTool({ name: FIXTURE.tools.unknown, arguments: {} })
    .catch(() => undefined);
  await client.readResource({ uri: FIXTURE.resourceUri });
  await client.getPrompt({ name: FIXTURE.prompt, arguments: { name: "Ada" } });
}

/** How the unknown-tool call is expected to surface for a framework. */
export type UnknownToolShape = "tool_error" | "error";

/** Assert the events `runScenarios` produced for one client. */
export function expectScenarioEvents(
  events: AnalyticsEvent[],
  options: {
    unknownTool: UnknownToolShape;
    /** Error message expected for the throwing tool. */
    explodeOutcome?: "tool_error" | "error";
  }
): void {
  const calls = byMethod(events, "tools/call");
  expect(calls).toHaveLength(4);

  const echo = only(calls, (e) => e.target === FIXTURE.tools.echo);
  expect(echo.outcome).toBe("success");
  expect(echo.error).toBeUndefined();
  expect(echo.duration_ms).toBeGreaterThanOrEqual(0);

  const fail = only(calls, (e) => e.target === FIXTURE.tools.fail);
  expect(fail.outcome).toBe("tool_error");
  expect(fail.error?.message).toBe("bad input");

  const explode = only(calls, (e) => e.target === FIXTURE.tools.explode);
  expect(explode.outcome).toBe(options.explodeOutcome ?? "tool_error");
  expect(explode.error?.message).toContain("kaput");

  const unknown = only(calls, (e) => e.target === FIXTURE.tools.unknown);
  expect(unknown.outcome).toBe(options.unknownTool);
  expect(unknown.error?.message).toContain("nope");
  if (options.unknownTool === "error") expect(unknown.error?.code).toBe(-32602);

  expect(only(events, (e) => e.method === "tools/list").outcome).toBe(
    "success"
  );
  const read = only(events, (e) => e.method === "resources/read");
  expect(read.target).toBe(FIXTURE.resourceUri);
  expect(read.outcome).toBe("success");
  const prompt = only(events, (e) => e.method === "prompts/get");
  expect(prompt.target).toBe(FIXTURE.prompt);
  expect(prompt.outcome).toBe("success");

  for (const event of events) {
    expect(event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(Number.isNaN(Date.parse(event.time))).toBe(false);
    expect(event.request_id).toBeDefined();
  }
  expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
}

/** Display claims of {@link NAMED_JWT}, sent only while "identify actors" is on. */
const ACTOR = { name: "Ada Lovelace", email: "ada@example.com" };

/** An unsigned JWT with `iss`, `sub` and the {@link ACTOR} claims. */
export const NAMED_JWT = `e30.${Buffer.from(
  JSON.stringify({ iss: "https://issuer.example", sub: "user_123", ...ACTOR })
).toString("base64url")}.sig`;

/** `actor.token_hash` of {@link NAMED_JWT}: `sha256(iss \0 sub)`. */
const NAMED_TOKEN_HASH = createHash("sha256")
  .update("https://issuer.example\0user_123")
  .digest("hex");

/**
 * Capture and identify turned on in the dashboard apply to the first batch
 * recorded a minute later, not to the one after it. `call` makes one `echo`
 * call as a client whose Bearer token is {@link NAMED_JWT}; the clients'
 * clock is replaced, so the test does not wait a real minute.
 */
export async function expectDashboardChangeReachesNextBatch(
  ingest: MockIngest,
  call: (args: Record<string, unknown>) => Promise<unknown>
): Promise<void> {
  const args = { text: "visible", api_key: "sk-123" };
  ingest.config = { capture_payloads: false, identify_actors: false };
  await call(args);
  await flush();
  const before = ingest.events();
  expect(before.length).toBeGreaterThan(0);
  for (const event of before) {
    expect(event.request_payload).toBeUndefined();
    expect(event.actor).toEqual({ token_hash: NAMED_TOKEN_HASH });
  }

  const clock = fakeConfigClock();
  ingest.config = { capture_payloads: true, identify_actors: true };
  clock.advance(61_000);
  await call(args);
  await flush();
  const after = ingest.events().slice(before.length);
  const echo = only(after, (e) => e.target === FIXTURE.tools.echo);
  expect(echo.request_payload).toMatchObject({
    method: "tools/call",
    params: {
      name: FIXTURE.tools.echo,
      arguments: { text: "visible", api_key: "[REDACTED]" },
    },
  });
  expect(echo.response_payload).toMatchObject({
    result: { content: [{ type: "text", text: "echo: visible" }] },
  });
  for (const event of after) {
    expect(event.request_payload).toBeDefined();
    expect(event.actor).toEqual({ token_hash: NAMED_TOKEN_HASH, ...ACTOR });
  }
  // One GET before the first batch and one refresh before this one.
  expect(
    ingest.requests.filter((r) => r.method === "GET").map((r) => r.path)
  ).toEqual(["/v1/config", "/v1/config"]);
}
