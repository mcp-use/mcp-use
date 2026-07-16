/**
 * Local smoke test for the Vercel entry point — no network, no `vercel dev`.
 * Invokes the exact handler Vercel would call (`api/mcp.ts`'s default export)
 * with synthetic Requests, performing a real JSON-RPC round trip. Node 24
 * runs erasable-syntax TypeScript directly:
 *
 *   node smoke.ts
 */
import assert from "node:assert/strict";

import vercelFunction from "./api/mcp.ts";
import { server } from "./mcp-server.ts";

const ORIGIN = "http://localhost:3000";
const PATH = "/api/mcp";

interface JsonRpcEnvelope<T> {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string };
}

/**
 * Build a stateless 2026-07-28 request: there is no initialize handshake —
 * every request carries the protocol version / client identity in a `_meta`
 * envelope (mirrored into `mcp-*` headers for routing).
 */
function jsonRpcRequest(
  host: string,
  id: number,
  method: string,
  params: Record<string, unknown>
): Request {
  return new Request(`${ORIGIN}${PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Streamable HTTP requires clients to accept both response framings.
      accept: "application/json, text/event-stream",
      host,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      // Name-addressed methods (tools/call, prompts/get, …) must mirror the
      // target name into the mcp-name header; a mismatch is rejected.
      ...(typeof params["name"] === "string" && {
        "mcp-name": params["name"],
      }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "smoke-test",
            version: "0.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

/** Modern (2026-07-28) exchanges answer with a single JSON body. */
async function parseJsonRpc<T>(
  response: Response
): Promise<JsonRpcEnvelope<T>> {
  return (await response.json()) as JsonRpcEnvelope<T>;
}

async function main(): Promise<void> {
  const handler = vercelFunction.fetch;

  // 1. tools/list — confirms both tools are registered and served.
  const listResponse = await handler(
    jsonRpcRequest("localhost:3000", 1, "tools/list", {})
  );
  assert.equal(listResponse.status, 200);
  const listBody = await parseJsonRpc<{ tools: Array<{ name: string }> }>(
    listResponse
  );
  assert.ok(listBody.result, "tools/list returned no result");
  const toolNames = listBody.result.tools.map((t) => t.name).sort();
  assert.deepEqual(toolNames, ["convert-temperature", "roll-dice"]);
  console.log("tools/list ok:", toolNames);

  // 2. tools/call — a real call producing typed structuredContent.
  const callResponse = await handler(
    jsonRpcRequest("localhost:3000", 2, "tools/call", {
      name: "convert-temperature",
      arguments: { value: 100, from: "celsius" },
    })
  );
  assert.equal(callResponse.status, 200);
  const callBody = await parseJsonRpc<{
    isError?: boolean;
    structuredContent?: {
      value: number;
      from: string;
      to: string;
      result: number;
    };
  }>(callResponse);
  assert.ok(callBody.result, "tools/call returned no result");
  assert.equal(callBody.result.isError, undefined);
  assert.deepEqual(callBody.result.structuredContent, {
    value: 100,
    from: "celsius",
    to: "fahrenheit",
    result: 212,
  });
  console.log("tools/call ok:", callBody.result.structuredContent);

  // 3. A second tool, content-only (no outputSchema), for variety.
  const rollResponse = await handler(
    jsonRpcRequest("localhost:3000", 3, "tools/call", {
      name: "roll-dice",
      arguments: { sides: 6, count: 2 },
    })
  );
  const rollBody = await parseJsonRpc<{
    content: Array<{ type: string; text?: string }>;
  }>(rollResponse);
  assert.ok(rollBody.result, "tools/call (roll-dice) returned no result");
  assert.match(rollBody.result.content[0]?.text ?? "", /^Rolled 2d6: /);
  console.log("tools/call (roll-dice) ok:", rollBody.result.content[0]?.text);

  // 4. A foreign Host is served: getHandler() applies no Host validation
  // (Vercel's edge only routes hostnames assigned to the deployment, so a
  // DNS-rebinding-style Host never reaches the function).
  const foreignHost = await handler(
    jsonRpcRequest("some-other.example.com", 4, "tools/list", {})
  );
  assert.equal(foreignHost.status, 200);
  console.log("foreign Host served (validation is the edge's job): ok");

  await server.close();
  console.log("\nAll smoke checks passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
