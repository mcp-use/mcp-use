import { ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { convertExternalHistoryToProvider } from "../messageFormat.js";
import type { ImageContentPart } from "../types.js";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

/**
 * Tool messages replayed through `externalHistory` used to lose every non-text
 * content block: the conversion kept only `.text`, so an image returned by a
 * tool vanished before the provider saw it. The inspector path already
 * preserved images via `toolResultToContent`.
 */
describe("convertExternalHistoryToProvider tool content", () => {
  it("preserves MCP image blocks in array content", () => {
    const [message] = convertExternalHistoryToProvider([
      new ToolMessage({
        content: [
          { type: "text", text: "Screenshot captured" },
          { type: "image", data: PNG, mimeType: "image/png" },
        ],
        tool_call_id: "call_1",
      }) as never,
    ]);

    expect(Array.isArray(message!.content)).toBe(true);
    const parts = message!.content as ImageContentPart[];
    const image = parts.find((part) => part.type === "image");
    expect(image?.data).toBe(PNG);
    expect(image?.mimeType).toBe("image/png");
  });

  it("preserves LangChain image_url blocks in array content", () => {
    const [message] = convertExternalHistoryToProvider([
      new ToolMessage({
        content: [
          { type: "text", text: "Screenshot captured" },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${PNG}` },
          },
        ],
        tool_call_id: "call_2",
      }) as never,
    ]);

    const parts = message!.content as ImageContentPart[];
    const image = parts.find((part) => part.type === "image");
    expect(image?.data).toBe(PNG);
    expect(image?.mimeType).toBe("image/png");
  });

  it("still collapses text-only array content to a string", () => {
    const [message] = convertExternalHistoryToProvider([
      new ToolMessage({
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ],
        tool_call_id: "call_3",
      }) as never,
    ]);

    expect(message!.content).toBe("first\nsecond");
  });

  it("leaves plain string content and error replay unchanged", () => {
    expect(
      convertExternalHistoryToProvider([
        new ToolMessage({
          content: "Earlier result",
          tool_call_id: "call_4",
        }) as never,
      ])
    ).toEqual([
      {
        role: "tool",
        content: "Earlier result",
        toolCallId: "call_4",
        toolResult: "Earlier result",
      },
    ]);

    const [errored] = convertExternalHistoryToProvider([
      new ToolMessage({
        content: "Tool failed",
        tool_call_id: "call_5",
        status: "error",
      }) as never,
    ]);
    expect(errored!.toolIsError).toBe(true);
  });
});
