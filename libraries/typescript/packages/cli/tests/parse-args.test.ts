import { describe, expect, it } from "vitest";
import { parsePromptArgs, parseToolArgs } from "../src/utils/parse-args.js";

describe("parseToolArgs", () => {
  it("returns empty object for no args", () => {
    expect(parseToolArgs(undefined)).toEqual({});
    expect(parseToolArgs([])).toEqual({});
  });

  it("parses key=value pairs as strings without a schema", () => {
    expect(parseToolArgs(["name=world", "greeting=hi"])).toEqual({
      name: "world",
      greeting: "hi",
    });
  });

  it("allows '=' inside the value (only the first separates key from value)", () => {
    expect(parseToolArgs(["query=a=b=c"])).toEqual({ query: "a=b=c" });
  });

  it("strips a leading -- so flag-style is forgiving", () => {
    expect(parseToolArgs(["--name=world"])).toEqual({ name: "world" });
  });

  it("coerces numbers when the schema says number/integer", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "integer" },
        ratio: { type: "number" },
      },
    };
    expect(parseToolArgs(["count=42", "ratio=3.14"], schema)).toEqual({
      count: 42,
      ratio: 3.14,
    });
  });

  it("rejects non-integer values for integer schema", () => {
    const schema = {
      type: "object",
      properties: { count: { type: "integer" } },
    };
    expect(() => parseToolArgs(["count=3.14"], schema)).toThrow(/integer/);
    expect(() => parseToolArgs(["count=foo"], schema)).toThrow(/integer/);
  });

  it("coerces booleans when the schema says boolean", () => {
    const schema = {
      type: "object",
      properties: { enabled: { type: "boolean" } },
    };
    expect(parseToolArgs(["enabled=true"], schema)).toEqual({ enabled: true });
    expect(parseToolArgs(["enabled=false"], schema)).toEqual({
      enabled: false,
    });
    expect(parseToolArgs(["enabled=1"], schema)).toEqual({ enabled: true });
    expect(parseToolArgs(["enabled=0"], schema)).toEqual({ enabled: false });
    expect(() => parseToolArgs(["enabled=maybe"], schema)).toThrow(/boolean/);
  });

  it("parses JSON when schema says array or object", () => {
    const schema = {
      type: "object",
      properties: {
        tags: { type: "array" },
        meta: { type: "object" },
      },
    };
    expect(parseToolArgs(['tags=["a","b"]', 'meta={"k":1}'], schema)).toEqual({
      tags: ["a", "b"],
      meta: { k: 1 },
    });
  });

  it("hints at := when array/object value is not valid JSON", () => {
    const schema = {
      type: "object",
      properties: { tags: { type: "array" } },
    };
    expect(() => parseToolArgs(["tags=a,b,c"], schema)).toThrow(/tags:=/);
  });

  it("supports :=jsonvalue to force JSON parsing", () => {
    expect(parseToolArgs(['meta:={"k":1}'])).toEqual({ meta: { k: 1 } });
    expect(parseToolArgs(["count:=42"])).toEqual({ count: 42 });
    expect(parseToolArgs(["enabled:=true"])).toEqual({ enabled: true });
    expect(parseToolArgs(["tags:=[1,2,3]"])).toEqual({ tags: [1, 2, 3] });
  });

  it("preserves := semantics over plain = when both appear", () => {
    expect(parseToolArgs(['expr:={"a":"b=c"}'])).toEqual({
      expr: { a: "b=c" },
    });
  });

  it("treats a single token starting with { as a full JSON object (backward compat)", () => {
    expect(parseToolArgs(['{"name":"world","count":3}'])).toEqual({
      name: "world",
      count: 3,
    });
  });

  it("rejects a non-object JSON value in the backward-compat form", () => {
    expect(() => parseToolArgs(["[1,2,3]"])).toThrow();
  });

  it("supports null type when schema permits it", () => {
    const schema = {
      type: "object",
      properties: { nickname: { type: ["string", "null"] } },
    };
    expect(parseToolArgs(["nickname=null"], schema)).toEqual({
      nickname: null,
    });
    expect(parseToolArgs(["nickname=Andy"], schema)).toEqual({
      nickname: "Andy",
    });
  });

  it("coerces values from nullable anyOf/oneOf schemas", () => {
    const schema = {
      type: "object",
      properties: {
        count: {
          anyOf: [{ type: "integer" }, { type: "null" }],
        },
        enabled: {
          oneOf: [{ type: "boolean" }, { type: "null" }],
        },
      },
    };

    expect(parseToolArgs(["count=42", "enabled=false"], schema)).toEqual({
      count: 42,
      enabled: false,
    });
    expect(parseToolArgs(["count=null", "enabled=null"], schema)).toEqual({
      count: null,
      enabled: null,
    });
  });

  it("preserves string fallback for mixed anyOf schemas", () => {
    const schema = {
      type: "object",
      properties: {
        value: {
          anyOf: [{ type: "integer" }, { type: "string" }, { type: "null" }],
        },
      },
    };

    expect(parseToolArgs(["value=abc"], schema)).toEqual({ value: "abc" });
    expect(parseToolArgs(["value=null"], schema)).toEqual({ value: null });
  });

  it("preserves string fallback when nullable unions include opaque variants", () => {
    const schema = {
      type: "object",
      properties: {
        mode: {
          anyOf: [{ type: "integer" }, { const: "auto" }, { type: "null" }],
        },
      },
    };

    expect(parseToolArgs(["mode=auto"], schema)).toEqual({ mode: "auto" });
    expect(parseToolArgs(["mode=null"], schema)).toEqual({ mode: null });
  });

  it("keeps unknown-key values as strings (schema only constrains known keys)", () => {
    const schema = {
      type: "object",
      properties: { count: { type: "integer" } },
    };
    expect(parseToolArgs(["count=5", "extra=hello"], schema)).toEqual({
      count: 5,
      extra: "hello",
    });
  });

  it("rejects tokens with no = separator", () => {
    expect(() => parseToolArgs(["name"])).toThrow(/key=value/);
  });

  it("rejects empty keys", () => {
    expect(() => parseToolArgs(["=value"])).toThrow(/Empty key/);
  });

  it("surfaces invalid JSON in :=jsonvalue with the key in the message", () => {
    expect(() => parseToolArgs(["meta:={bad json}"])).toThrow(/meta/);
  });
});

describe("parsePromptArgs", () => {
  it("returns empty object for no args", () => {
    expect(parsePromptArgs(undefined)).toEqual({});
    expect(parsePromptArgs([])).toEqual({});
  });

  it("parses key=value pairs as strings without coercion", () => {
    expect(parsePromptArgs(["topic=birds", "count=5"])).toEqual({
      topic: "birds",
      count: "5",
    });
  });

  it("strips a leading --", () => {
    expect(parsePromptArgs(["--topic=birds"])).toEqual({ topic: "birds" });
  });

  it("accepts a single JSON object (backward compat) and stringifies non-string values", () => {
    expect(parsePromptArgs(['{"topic":"birds","count":5}'])).toEqual({
      topic: "birds",
      count: "5",
    });
  });

  it("rejects tokens with no = separator", () => {
    expect(() => parsePromptArgs(["topic"])).toThrow(/key=value/);
  });
});
