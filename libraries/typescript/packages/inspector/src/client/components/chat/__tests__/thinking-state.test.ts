import { describe, expect, it } from "vitest";
import { deriveIsThinking } from "../thinking-state";

describe("deriveIsThinking", () => {
  it("is false when not loading", () => {
    expect(deriveIsThinking(false, [])).toBe(false);
  });

  it("is true when loading with no messages", () => {
    expect(deriveIsThinking(true, [])).toBe(true);
  });

  it("is true when loading and last message is from the user", () => {
    expect(deriveIsThinking(true, [{ role: "user", content: "hello" }])).toBe(
      true
    );
  });

  it("is false when the last assistant message has a text part", () => {
    expect(
      deriveIsThinking(true, [
        {
          role: "assistant",
          content: "",
          parts: [{ type: "text", text: "some text" }],
        },
      ])
    ).toBe(false);
  });

  it("is false when the last assistant part is a pending tool call", () => {
    expect(
      deriveIsThinking(true, [
        {
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                toolName: "search",
                args: {},
                state: "pending",
              },
            },
          ],
        },
      ])
    ).toBe(false);
  });

  it("is false when the last assistant part is a streaming tool call", () => {
    expect(
      deriveIsThinking(true, [
        {
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                toolName: "search",
                args: {},
                state: "streaming",
              },
            },
          ],
        },
      ])
    ).toBe(false);
  });

  it("is true after a tool result while still loading (between tool calls)", () => {
    expect(
      deriveIsThinking(true, [
        {
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                toolName: "search",
                args: {},
                result: { count: 1 },
                state: "result",
              },
            },
          ],
        },
      ])
    ).toBe(true);
  });

  it("is false when a new text part follows a completed tool result", () => {
    expect(
      deriveIsThinking(true, [
        {
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                toolName: "search",
                args: {},
                result: { count: 1 },
                state: "result",
              },
            },
            { type: "text", text: "Here are the results..." },
          ],
        },
      ])
    ).toBe(false);
  });

  it("is true when the last assistant message has no content and no parts", () => {
    expect(deriveIsThinking(true, [{ role: "assistant", content: "" }])).toBe(
      true
    );
  });

  it("is true when the last assistant message has only whitespace content", () => {
    expect(
      deriveIsThinking(true, [{ role: "assistant", content: "   " }])
    ).toBe(true);
  });

  it("is true after a tool error while still loading (model continues after failed tool call)", () => {
    expect(
      deriveIsThinking(true, [
        {
          role: "assistant",
          content: "",
          parts: [
            {
              type: "tool-invocation",
              toolInvocation: {
                toolName: "search",
                args: {},
                state: "error",
              },
            },
          ],
        },
      ])
    ).toBe(true);
  });
});
