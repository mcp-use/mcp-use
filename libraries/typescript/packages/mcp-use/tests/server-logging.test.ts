import { describe, expect, it } from "vitest";

import {
  detectOutcome,
  extractTarget,
  renderArgs,
  type Outcome,
} from "../src/server/logging.js";

describe("extractTarget", () => {
  it("returns client name/version for initialize", () => {
    expect(
      extractTarget({
        method: "initialize",
        params: { clientInfo: { name: "Claude", version: "0.8.3" } },
      })
    ).toBe("Claude/0.8.3");
  });

  it("returns only name when version missing on initialize", () => {
    expect(
      extractTarget({
        method: "initialize",
        params: { clientInfo: { name: "Claude" } },
      })
    ).toBe("Claude");
  });

  it("returns null for initialize with no clientInfo", () => {
    expect(extractTarget({ method: "initialize", params: {} })).toBe(null);
  });

  it("returns tool name for tools/call", () => {
    expect(
      extractTarget({
        method: "tools/call",
        params: { name: "create_invoice", arguments: { amount: 100 } },
      })
    ).toBe("create_invoice");
  });

  it("returns prompt name for prompts/get", () => {
    expect(
      extractTarget({ method: "prompts/get", params: { name: "summarize" } })
    ).toBe("summarize");
  });

  it("returns URI for resources/read", () => {
    expect(
      extractTarget({
        method: "resources/read",
        params: { uri: "file:///a/b.txt" },
      })
    ).toBe("file:///a/b.txt");
  });

  it("returns URI for resources/subscribe", () => {
    expect(
      extractTarget({
        method: "resources/subscribe",
        params: { uri: "mcp://thing" },
      })
    ).toBe("mcp://thing");
  });

  it("returns null for methods without a natural target", () => {
    expect(extractTarget({ method: "tools/list" })).toBe(null);
    expect(extractTarget({ method: "resources/list" })).toBe(null);
    expect(extractTarget({ method: "ping" })).toBe(null);
  });

  it("returns null for malformed input", () => {
    expect(extractTarget(null)).toBe(null);
    expect(extractTarget("not an object")).toBe(null);
    expect(extractTarget({})).toBe(null);
    expect(extractTarget({ method: 42 })).toBe(null);
  });
});

describe("renderArgs", () => {
  it("renders compact single-line JSON for tools/call arguments", () => {
    expect(
      renderArgs({
        method: "tools/call",
        params: {
          name: "create_invoice",
          arguments: { amount: 100, currency: "USD" },
        },
      })
    ).toBe('{"amount":100,"currency":"USD"}');
  });

  it("renders prompts/get arguments", () => {
    expect(
      renderArgs({
        method: "prompts/get",
        params: { name: "summarize", arguments: { topic: "q3" } },
      })
    ).toBe('{"topic":"q3"}');
  });

  it("returns null when arguments object is empty", () => {
    expect(
      renderArgs({
        method: "tools/call",
        params: { name: "t", arguments: {} },
      })
    ).toBe(null);
  });

  it("returns null when arguments are missing", () => {
    expect(renderArgs({ method: "tools/call", params: { name: "t" } })).toBe(
      null
    );
  });

  it("returns null for methods other than tools/call or prompts/get", () => {
    expect(
      renderArgs({
        method: "resources/read",
        params: { uri: "file:///x" },
      })
    ).toBe(null);
    expect(renderArgs({ method: "tools/list" })).toBe(null);
  });

  it("preserves long string values up to the total-length cap", () => {
    // A 300-char URL-like value should print intact — no per-string truncation.
    const url = "https://example.com/" + "a".repeat(300);
    const out = renderArgs({
      method: "tools/call",
      params: { name: "t", arguments: { url } },
    });
    expect(out).toContain(url);
    expect(out).not.toContain("...<truncated>");
  });

  it("caps the overall rendered args length", () => {
    const huge = "x".repeat(5000);
    const out = renderArgs({
      method: "tools/call",
      params: { name: "t", arguments: { blob: huge } },
    });
    expect(out).not.toBeNull();
    expect(out!.endsWith("...<truncated>")).toBe(true);
    // Cap is 2000 chars + suffix.
    expect(out!.length).toBeLessThanOrEqual(2000 + "...<truncated>".length);
  });

  it("caps nested-object depth", () => {
    const deep: any = { a: { b: { c: { d: { e: "bottom" } } } } };
    const out = renderArgs({
      method: "tools/call",
      params: { name: "t", arguments: deep },
    });
    expect(out).toContain("{...}");
  });
});

describe("detectOutcome", () => {
  it("returns ok for 2xx with a result body", () => {
    const outcome = detectOutcome(
      200,
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })
    );
    expect(outcome).toEqual<Outcome>({ kind: "ok" });
  });

  it("returns rpc-error when the body carries a JSON-RPC error", () => {
    const outcome = detectOutcome(
      200,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "Invalid API key" },
      })
    );
    expect(outcome).toEqual<Outcome>({
      kind: "rpc-error",
      code: -32603,
      message: "Invalid API key",
    });
  });

  it("returns rpc-error for tool-level isError with extracted text", () => {
    const outcome = detectOutcome(
      200,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          isError: true,
          content: [{ type: "text", text: "tool blew up: bad input" }],
        },
      })
    );
    expect(outcome).toEqual<Outcome>({
      kind: "rpc-error",
      code: null,
      message: "tool blew up: bad input",
    });
  });

  it("returns http for non-2xx status codes", () => {
    expect(detectOutcome(400, null)).toEqual<Outcome>({
      kind: "http",
      status: 400,
    });
    expect(detectOutcome(500, "oops")).toEqual<Outcome>({
      kind: "http",
      status: 500,
    });
  });

  it("treats non-JSON 2xx bodies as ok", () => {
    expect(detectOutcome(200, "not json at all")).toEqual<Outcome>({
      kind: "ok",
    });
  });

  it("treats empty 2xx bodies as ok", () => {
    expect(detectOutcome(200, null)).toEqual<Outcome>({ kind: "ok" });
  });

  it("finds the first error in a JSON-RPC batch response", () => {
    const outcome = detectOutcome(
      200,
      JSON.stringify([
        { jsonrpc: "2.0", id: 1, result: { ok: true } },
        {
          jsonrpc: "2.0",
          id: 2,
          error: { code: -32000, message: "batch member failed" },
        },
      ])
    );
    expect(outcome).toEqual<Outcome>({
      kind: "rpc-error",
      code: -32000,
      message: "batch member failed",
    });
  });

  it("truncates very long error messages", () => {
    const longMsg = "a".repeat(500);
    const outcome = detectOutcome(
      200,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: longMsg },
      })
    );
    expect(outcome.kind).toBe("rpc-error");
    if (outcome.kind === "rpc-error") {
      expect(outcome.message.length).toBeLessThanOrEqual(204);
      expect(outcome.message.endsWith("...")).toBe(true);
    }
  });
});
