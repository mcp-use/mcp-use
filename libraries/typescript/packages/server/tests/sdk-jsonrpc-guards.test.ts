import {
  isJSONRPCErrorResponse,
  isJSONRPCResultResponse,
} from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

describe("patched SDK JSON-RPC response guards", () => {
  it("accepts valid result and error responses", () => {
    expect(
      isJSONRPCResultResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true },
      })
    ).toBe(true);
    expect(
      isJSONRPCErrorResponse({
        jsonrpc: "2.0",
        id: "request-1",
        error: { code: -32600, message: "Invalid Request" },
      })
    ).toBe(true);
  });

  it("rejects requests, notifications, primitives, and malformed responses", () => {
    const values = [
      undefined,
      null,
      1,
      "response",
      [],
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: {} },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 1 },
      { jsonrpc: "2.0", id: 1, result: undefined },
      { jsonrpc: "2.0", id: 1, error: { code: "bad", message: "no" } },
    ];

    for (const value of values) {
      expect(isJSONRPCResultResponse(value)).toBe(false);
      expect(isJSONRPCErrorResponse(value)).toBe(false);
    }
  });
});
