/**
 * Runs the exported Worker handler directly under Node's `workerd` export
 * condition. This catches Node-only imports in the edge build without
 * starting Wrangler or listening on a socket.
 */
import assert from "node:assert/strict";

import type { ExecutionContext } from "@cloudflare/workers-types";

import worker from "./worker.ts";

const ORIGIN = "https://workers.example";
const PATH = "/mcp";

interface JsonRpcEnvelope<T> {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string };
}

function jsonRpcRequest(
  id: number,
  method: string,
  params: Record<string, unknown>
): Request {
  return new Request(`${ORIGIN}${PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
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
            name: "cloudflare-workers-smoke",
            version: "0.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

async function parseJsonRpc<T>(
  response: Response
): Promise<JsonRpcEnvelope<T>> {
  return (await response.json()) as JsonRpcEnvelope<T>;
}

async function main(): Promise<void> {
  const resolved = import.meta.resolve("mcp-use");
  assert.match(
    resolved,
    /\/dist\/index\.js$/,
    `Expected the workerd export condition, resolved ${resolved}`
  );

  const context = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;

  const listResponse = await worker.fetch(
    jsonRpcRequest(1, "tools/list", {}),
    {},
    context
  );
  assert.equal(listResponse.status, 200);
  const listBody = await parseJsonRpc<{ tools: Array<{ name: string }> }>(
    listResponse
  );
  assert.ok(listBody.result, "tools/list returned no result");
  assert.deepEqual(
    listBody.result.tools.map((tool) => tool.name),
    ["echo"]
  );

  const callResponse = await worker.fetch(
    jsonRpcRequest(2, "tools/call", {
      name: "echo",
      arguments: { message: "hello from workerd" },
    }),
    {},
    context
  );
  assert.equal(callResponse.status, 200);
  const callBody = await parseJsonRpc<{
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  }>(callResponse);
  assert.ok(callBody.result, "tools/call returned no result");
  assert.equal(callBody.result.isError, undefined);
  assert.equal(
    callBody.result.content?.[0]?.text,
    "Cloudflare Worker: hello from workerd"
  );

  console.log("Cloudflare Workers smoke checks passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
