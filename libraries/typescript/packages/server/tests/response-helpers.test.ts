import { describe, expect, it } from "vitest";

import {
  toPromptResult,
  toResourceResult,
} from "../src/response-conversion.js";
import {
  array,
  error,
  image,
  mix,
  object,
  text,
  widget,
} from "../src/response-helpers.js";

describe("response helpers", () => {
  it("text maps to a text content block", () => {
    expect(text("hello")).toEqual({
      content: [{ type: "text", text: "hello" }],
      _meta: { mimeType: "text/plain" },
    });
  });

  it("object maps to JSON text + structuredContent", () => {
    const data = { city: "Paris", temperature: "22°C" };
    expect(object(data)).toEqual({
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
      _meta: { mimeType: "application/json" },
    });
  });

  it("array uses the array as structuredContent (no { data } wrap)", () => {
    const data = [1, 2, 3];
    expect(array(data)).toEqual({
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
    });
  });

  it("error sets isError", () => {
    expect(error("boom")).toEqual({
      isError: true,
      content: [{ type: "text", text: "boom" }],
    });
  });

  it("widget maps props to structuredContent and output to content", () => {
    expect(
      widget({
        props: { q: "mango" },
        output: text("Found 1"),
      })
    ).toEqual({
      content: [{ type: "text", text: "Found 1" }],
      structuredContent: { q: "mango" },
    });
  });

  it("mix concatenates content and shallow-merges structuredContent", () => {
    expect(mix(text("a"), object({ b: 1 }))).toEqual({
      content: [
        { type: "text", text: "a" },
        { type: "text", text: JSON.stringify({ b: 1 }, null, 2) },
      ],
      structuredContent: { b: 1 },
      _meta: { mimeType: "application/json" },
    });
  });
});

describe("toResourceResult", () => {
  const uri = "app://greeting";

  it("passes through ReadResourceResult", () => {
    const raw = {
      contents: [{ uri, mimeType: "text/plain", text: "hi" }],
    };
    expect(toResourceResult(raw, uri)).toBe(raw);
  });

  it("maps text blocks using _meta.mimeType", () => {
    expect(toResourceResult(text("hello"), uri)).toEqual({
      contents: [{ uri, mimeType: "text/plain", text: "hello" }],
    });
  });

  it("maps image data to blob", () => {
    expect(toResourceResult(image("abc123", "image/png"), uri)).toEqual({
      contents: [{ uri, mimeType: "image/png", blob: "abc123" }],
    });
  });

  it("unwraps embedded resource contents", () => {
    expect(
      toResourceResult(
        {
          content: [
            {
              type: "resource",
              resource: {
                uri: "file://x",
                mimeType: "text/plain",
                text: "embedded",
              },
            },
          ],
        },
        uri
      )
    ).toEqual({
      contents: [{ uri: "file://x", mimeType: "text/plain", text: "embedded" }],
    });
  });

  it("skips resource_link blocks", () => {
    expect(
      toResourceResult(
        {
          content: [
            {
              type: "resource_link",
              uri: "app://other",
              name: "other",
            },
          ],
        },
        uri
      )
    ).toEqual({
      contents: [{ uri, mimeType: "text/plain", text: "" }],
    });
  });

  it("falls back to structuredContent JSON when content is empty", () => {
    expect(
      toResourceResult({ content: [], structuredContent: { ok: true } }, uri)
    ).toEqual({
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ ok: true }),
        },
      ],
    });
  });
});

describe("toPromptResult", () => {
  it("passes through GetPromptResult", () => {
    const raw = {
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: "x" },
        },
      ],
    };
    expect(toPromptResult(raw)).toBe(raw);
  });

  it("maps each content block to a user message", () => {
    expect(toPromptResult(text("review this"))).toEqual({
      messages: [
        {
          role: "user",
          content: { type: "text", text: "review this" },
        },
      ],
    });
  });

  it("falls back to structuredContent when content is empty", () => {
    expect(
      toPromptResult({ content: [], structuredContent: { a: 1 } })
    ).toEqual({
      messages: [
        {
          role: "user",
          content: { type: "text", text: JSON.stringify({ a: 1 }) },
        },
      ],
    });
  });
});
