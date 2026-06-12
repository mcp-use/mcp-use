import { describe, expect, it } from "vitest";
import { renderTranscript } from "../src/agent.js";

// Events shaped like the Agent SDK's message stream (SDKMessage union):
// assistant/user wrap an API message, result carries run totals.
const EVENTS: Record<string, unknown>[] = [
  {
    type: "system",
    subtype: "init",
    session_id: "s1",
    tools: ["Bash", "Write"],
  },
  {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Creating the server entry file." },
        {
          type: "tool_use",
          name: "Write",
          input: { file_path: "src/server.ts" },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          content: [{ type: "text", text: "File created successfully" }],
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          is_error: true,
          content: "command not found: tsx",
        },
      ],
    },
  },
  {
    type: "result",
    subtype: "success",
    num_turns: 4,
    total_cost_usd: 0.12,
    duration_ms: 30000,
  },
];

describe("renderTranscript", () => {
  it("condenses SDK events into text, tool calls, results and run totals", () => {
    const md = renderTranscript(EVENTS);
    expect(md).toContain("Creating the server entry file.");
    expect(md).toContain('[tool] Write({"file_path":"src/server.ts"})');
    expect(md).toContain("`[result]` File created successfully");
    expect(md).toContain("`[result ERROR]` command not found: tsx");
    expect(md).toContain("[run result] turns=4 cost=$0.12 duration=30000ms");
  });

  it("surfaces non-success result subtypes and harness notes", () => {
    const md = renderTranscript([
      {
        type: "result",
        subtype: "error_max_turns",
        num_turns: 50,
        total_cost_usd: 1.5,
        duration_ms: 90000,
      },
      { type: "harness", note: "agent timed out after 1200000ms" },
    ]);
    expect(md).toContain("[run result] error_max_turns turns=50");
    expect(md).toContain("[harness] agent timed out after 1200000ms");
  });

  it("ignores message types it does not render", () => {
    expect(
      renderTranscript([
        { type: "system", subtype: "init" },
        { type: "stream_event", event: {} },
      ])
    ).toBe("");
  });
});
