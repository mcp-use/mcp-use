import { describe, expect, it } from "vitest";
import {
  extractToolResultParts,
  toolResultToContent,
} from "../toolResultParts";
import type { ImageContentPart, TextContentPart } from "../types";

describe("extractToolResultParts", () => {
  it("wraps a plain string in a single text part", () => {
    const parts = extractToolResultParts("hello world");
    expect(parts).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("returns an empty array for empty string", () => {
    expect(extractToolResultParts("")).toEqual([]);
  });

  it("extracts text blocks from an MCP-shaped result", () => {
    const parts = extractToolResultParts({
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    });
    expect(parts).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
  });

  it("extracts image blocks with data, mimeType, and synthesized data URL", () => {
    const parts = extractToolResultParts({
      content: [{ type: "image", data: "AAAA", mimeType: "image/jpeg" }],
    });
    expect(parts).toHaveLength(1);
    const img = parts[0] as ImageContentPart;
    expect(img.type).toBe("image");
    expect(img.data).toBe("AAAA");
    expect(img.mimeType).toBe("image/jpeg");
    expect(img.url).toBe("data:image/jpeg;base64,AAAA");
  });

  it("mixes text and image parts in order", () => {
    const parts = extractToolResultParts({
      content: [
        { type: "text", text: "caption" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
    });
    expect(parts.map((p) => p.type)).toEqual(["text", "image"]);
  });

  it("strips _meta from the result root", () => {
    const parts = extractToolResultParts({
      _meta: { mimeType: "image/png", isImage: true },
      content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("image");
  });

  it("appends structuredContent as a JSON text part", () => {
    const parts = extractToolResultParts({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { count: 3, items: ["a", "b"] },
    });
    expect(parts).toHaveLength(2);
    const tail = parts[1] as TextContentPart;
    expect(tail.type).toBe("text");
    expect(tail.text).toMatch(/^structuredContent: /);
    expect(JSON.parse(tail.text.replace(/^structuredContent: /, ""))).toEqual({
      count: 3,
      items: ["a", "b"],
    });
  });

  it("prepends an error marker when isError is true", () => {
    const parts = extractToolResultParts({
      isError: true,
      content: [{ type: "text", text: "boom" }],
    });
    expect(parts[0]).toEqual({
      type: "text",
      text: "[tool reported isError=true]",
    });
    expect(parts[1]).toEqual({ type: "text", text: "boom" });
  });

  it("renders embedded resource text directly", () => {
    const parts = extractToolResultParts({
      content: [
        {
          type: "resource",
          resource: { uri: "app://x", text: "inside", mimeType: "text/plain" },
        },
      ],
    });
    expect(parts).toEqual([{ type: "text", text: "inside" }]);
  });

  it("renders an image resource blob as an image part", () => {
    const parts = extractToolResultParts({
      content: [
        {
          type: "resource",
          resource: {
            uri: "app://x.png",
            blob: "AAAA",
            mimeType: "image/png",
          },
        },
      ],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("image");
    expect((parts[0] as ImageContentPart).data).toBe("AAAA");
  });

  it("emits an audio marker (out of scope) instead of dropping it", () => {
    const parts = extractToolResultParts({
      content: [{ type: "audio", data: "AAAA", mimeType: "audio/wav" }],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("text");
    expect((parts[0] as TextContentPart).text).toMatch(/^\[audio: audio\/wav/);
  });

  it("emits a resource_link marker with name + uri", () => {
    const parts = extractToolResultParts({
      content: [{ type: "resource_link", uri: "app://doc", name: "doc" }],
    });
    expect(parts).toEqual([
      { type: "text", text: '[resource_link "doc": app://doc]' },
    ]);
  });

  it("stringifies non-MCP-shaped objects", () => {
    const parts = extractToolResultParts({ answer: 42 });
    expect(parts).toEqual([{ type: "text", text: '{"answer":42}' }]);
  });
});

describe("toolResultToContent", () => {
  it("collapses text-only results to a flat string", () => {
    const out = toolResultToContent({
      content: [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
    });
    expect(out).toBe("one\ntwo");
  });

  it("returns ContentPart[] when an image is present", () => {
    const out = toolResultToContent({
      content: [
        { type: "text", text: "caption" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
    });
    expect(Array.isArray(out)).toBe(true);
    const parts = out as Array<TextContentPart | ImageContentPart>;
    expect(parts.map((p) => p.type)).toEqual(["text", "image"]);
  });

  it("preserves the plain-string path for plain-string results", () => {
    expect(toolResultToContent("ok")).toBe("ok");
  });
});
