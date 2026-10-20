import { readFileSync } from "node:fs";

import {
  boundedPayload,
  isCredentialValue,
  isSensitiveKey,
  MAX_PAYLOAD_CHARS,
  MAX_STRING_CHARS,
  REDACTED,
  redactValue,
} from "../src/redact.js";

/**
 * Vectors both default redactors must pass; the Python SDK's copy is the
 * reference, read in place so the two can never drift apart.
 */
const VECTORS = JSON.parse(
  readFileSync(
    new URL(
      "../../../../python-analytics/tests/fixtures/redaction_vectors.json",
      import.meta.url
    ),
    "utf8"
  )
) as {
  sensitive_keys: string[];
  ordinary_keys: string[];
  cases: Array<{
    name: string;
    input?: unknown;
    input_json?: string;
    expected: unknown;
  }>;
};

describe("shared redaction vectors", () => {
  it.each(VECTORS.sensitive_keys)("redacts the key %j", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
    expect(redactValue({ [key]: "v" })).toEqual({ [key]: REDACTED });
  });

  it.each(VECTORS.ordinary_keys)("keeps the key %j", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it.each(VECTORS.cases.map((c) => [c.name, c] as const))(
    "%s",
    (_name, vector) => {
      const input =
        vector.input_json !== undefined
          ? (JSON.parse(vector.input_json) as unknown)
          : vector.input;
      expect(redactValue(input)).toEqual(vector.expected);
    }
  );
});

describe("credential-shaped values", () => {
  it.each([
    "Bearer abcdefghijklmnopqrstuvwxyz",
    "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl",
    "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.",
    "MFI_ABCDEFGHIJKLMNOPQRST",
    // Python's `$` also matches before a final newline.
    "mfi_abcdefghijklmnopqrstuvwxyz012345\n",
  ])("redacts %j", (value) => {
    expect(isCredentialValue(value)).toBe(true);
    expect(redactValue(value)).toBe(REDACTED);
  });

  it.each([
    "Bearer short",
    "eyJhbGciOiJIUzI1NiJ9",
    "my token is mfi_abcdefghijklmnopqrstuvwxyz012345",
    "hello world",
  ])("keeps %j", (value) => {
    expect(redactValue(value)).toBe(value);
  });

  it("redacts them under neutral keys at any depth", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl";
    expect(
      redactValue({
        params: {
          arguments: {
            headers: { "X-Upstream": `Bearer ${"t".repeat(24)}` },
            jwt,
            list: [jwt, "plain"],
            aws_secret_access_key: "AKIA…",
          },
        },
      })
    ).toEqual({
      params: {
        arguments: {
          headers: { "X-Upstream": REDACTED },
          jwt: REDACTED,
          list: [REDACTED, "plain"],
          aws_secret_access_key: REDACTED,
        },
      },
    });
  });
});

describe("isSensitiveKey", () => {
  it.each([
    "authorization",
    "Authorization",
    "password",
    "user_password",
    "client_secret",
    "token",
    "access_token",
    "refreshToken",
    "api_key",
    "X-Api-Key",
    "apiKey",
    "cookie",
    "Set-Cookie",
    "private_key",
    "credentials",
    "auth",
  ])("redacts %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "max_tokens",
    "outputTokens",
    "author",
    "name",
    "query",
    "keyword",
    "tokenizer",
  ])("keeps %s", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe("redactValue", () => {
  it("redacts sensitive keys at any depth without touching the input", () => {
    const input = {
      params: {
        arguments: {
          query: "weather",
          password: "hunter2",
          nested: [{ api_key: "k" }],
        },
      },
      headers: { Authorization: "Bearer x" },
    };
    const copy = redactValue(input);
    expect(copy).toEqual({
      params: {
        arguments: {
          query: "weather",
          password: REDACTED,
          nested: [{ api_key: REDACTED }],
        },
      },
      headers: { Authorization: REDACTED },
    });
    expect(input.params.arguments.password).toBe("hunter2");
  });

  it("replaces binary data and base64 media with a size note", () => {
    expect(
      redactValue({ buf: new Uint8Array(3), ab: new ArrayBuffer(4) })
    ).toEqual({
      buf: "[binary 3 bytes]",
      ab: "[binary 4 bytes]",
    });
    expect(
      redactValue({
        content: [
          { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
          { type: "text", data: "kept" },
        ],
        contents: [{ uri: "file://a", blob: "AAAA" }],
      })
    ).toEqual({
      content: [
        {
          type: "image",
          data: "[binary 5 bytes]",
          mimeType: "image/png",
        },
        { type: "text", data: "kept" },
      ],
      contents: [{ uri: "file://a", blob: "[binary 3 bytes]" }],
    });
  });

  it("cuts long strings", () => {
    const value = redactValue({ text: "a".repeat(MAX_STRING_CHARS + 5) }) as {
      text: string;
    };
    expect(value.text.startsWith("a".repeat(MAX_STRING_CHARS))).toBe(true);
    expect(value.text).toContain("[truncated 5 chars]");
  });

  it("replaces cycles but keeps repeated references", () => {
    const shared = { x: 1 };
    const cyclic: Record<string, unknown> = { shared, again: shared };
    cyclic["self"] = cyclic;
    expect(redactValue(cyclic)).toEqual({
      shared: { x: 1 },
      again: { x: 1 },
      self: "[Circular]",
    });
  });

  it("produces JSON-safe values", () => {
    expect(
      redactValue({
        n: Number.NaN,
        big: 10n,
        date: new Date("2026-01-01T00:00:00.000Z"),
        fn: () => 1,
        undef: undefined,
        list: [undefined, () => 1],
        sym: Symbol("x"),
      })
    ).toEqual({
      n: null,
      big: "10",
      date: "2026-01-01T00:00:00.000Z",
      list: [null, null],
    });
  });

  it("bounds depth", () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 40; i++) {
      const next: Record<string, unknown> = {};
      deep["child"] = next;
      deep = next;
    }
    expect(JSON.stringify(redactValue(root))).toContain("[MaxDepth]");
  });

  it("ignores __proto__ keys from parsed JSON", () => {
    const parsed = JSON.parse(
      '{"__proto__":{"polluted":true},"ok":1}'
    ) as unknown;
    const copy = redactValue(parsed) as Record<string, unknown>;
    expect(copy).toEqual({ ok: 1 });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("boundedPayload", () => {
  it("returns the redacted copy under the cap", () => {
    expect(boundedPayload({ secret: "s", ok: true })).toEqual({
      secret: REDACTED,
      ok: true,
    });
  });

  it("returns the gateway's truncation marker over the cap", () => {
    const items = Array.from({ length: 30 }, () =>
      "x".repeat(MAX_STRING_CHARS)
    );
    const payload = boundedPayload({ items }) as {
      _truncated: boolean;
      _message: string;
    };
    expect(payload._truncated).toBe(true);
    expect(payload._message).toMatch(/^Payload too large \(\d+ bytes\)$/);
    expect(JSON.stringify(payload).length).toBeLessThan(MAX_PAYLOAD_CHARS);
  });

  it("passes undefined through", () => {
    expect(boundedPayload(undefined)).toBeUndefined();
  });
});
