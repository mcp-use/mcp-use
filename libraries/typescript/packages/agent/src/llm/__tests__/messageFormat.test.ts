import { describe, expect, it } from "vitest";
import { convertMessagesToProvider } from "../messageFormat";

describe("convertMessagesToProvider", () => {
  it("propagates toolIsError when the saved MCP result has isError: true", () => {
    const out = convertMessagesToProvider([
      { role: "user", content: "trigger" },
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: {
              toolName: "boom",
              args: {},
              result: {
                isError: true,
                content: [{ type: "text", text: "kaboom" }],
              },
            },
          },
        ],
      },
    ]);
    const toolMsg = out.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolIsError).toBe(true);
  });

  it("preserves toolIsError across replay when the saved result is a synthetic throw payload", () => {
    // toolLoop.ts records `{ isError: true, error: "..." }` when callTool
    // throws; the replay path must still flag the tool message as an error.
    const out = convertMessagesToProvider([
      { role: "user", content: "trigger" },
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: {
              toolName: "thrower",
              args: {},
              result: { isError: true, error: "boom" },
            },
          },
        ],
      },
    ]);
    const toolMsg = out.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolIsError).toBe(true);
  });

  it("leaves toolIsError false when the saved result has no error flag", () => {
    const out = convertMessagesToProvider([
      { role: "user", content: "trigger" },
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: {
              toolName: "ok",
              args: {},
              result: { content: [{ type: "text", text: "fine" }] },
            },
          },
        ],
      },
    ]);
    const toolMsg = out.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolIsError).toBe(false);
  });
});
