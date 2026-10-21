/**
 * Regression tests for MCPAgent streamEvents() input assembly
 *
 * These tests verify that streamEvents() passes the current user query to the
 * agent executor exactly once. The query used to be pushed into
 * conversationHistory before the history snapshot was taken, so it reached the
 * model twice: once inside the history and once as the trailing HumanMessage.
 *
 * They also verify that the user message is only committed to memory after the
 * stream completes, so a stream that throws leaves no orphaned HumanMessage
 * (an unanswered query the next turn would feed back to the model).
 */

import { describe, expect, it, vi } from "vitest";
import { MCPAgent } from "../src/agents/mcp_agent_langchain.js";

describe("mCPAgent streamEvents() input assembly", () => {
  it("sends the current query to the executor exactly once per turn", async () => {
    const agent = new MCPAgent({
      llm: { fakeModel: true } as any,
      connectors: [{ fakeConnector: true }] as any,
      memoryEnabled: true,
    });
    (agent as any)._initialized = true;

    const capturedInputs: Array<{ messages: any[] }> = [];
    let call = 0;
    (agent as any)._agentExecutor = {
      streamEvents: vi.fn().mockImplementation(async function* (inputs: any) {
        capturedInputs.push(inputs);
        yield {
          event: "on_chat_model_stream",
          data: { chunk: { content: `answer-${++call}` } },
        } as any;
      }),
    };
    vi.spyOn((agent as any).telemetry, "trackAgentExecution").mockResolvedValue(
      undefined
    );

    const humanMessagesWith = (messages: any[], content: string) =>
      messages.filter((m) => m.getType?.() === "human" && m.content === content)
        .length;

    // Turn 1: fresh history
    for await (const _ of agent.streamEvents({ prompt: "hello" })) {
      void _;
    }

    // Turn 2: history now holds turn 1
    for await (const _ of agent.streamEvents({ prompt: "world" })) {
      void _;
    }

    const [firstTurn, secondTurn] = capturedInputs.map((input) =>
      input.messages.map((m) => ({
        type: m.getType?.() ?? m.type,
        content: m.content,
      }))
    );

    // The current query is sent exactly once, on every turn
    expect(humanMessagesWith(capturedInputs[0].messages, "hello")).toBe(1);
    expect(humanMessagesWith(capturedInputs[1].messages, "world")).toBe(1);

    // Turn 1 starts from an empty history: inputs are just the query
    expect(firstTurn).toEqual([{ type: "human", content: "hello" }]);

    // Turn 2 keeps prior turns in memory without duplicating them
    expect(secondTurn).toEqual([
      { type: "human", content: "hello" },
      { type: "ai", content: "answer-1" },
      { type: "human", content: "world" },
    ]);
  });

  it("leaves no orphaned user message in memory when the stream fails", async () => {
    const agent = new MCPAgent({
      llm: { fakeModel: true } as any,
      connectors: [{ fakeConnector: true }] as any,
      memoryEnabled: true,
    });
    (agent as any)._initialized = true;

    (agent as any)._agentExecutor = {
      streamEvents: vi.fn().mockImplementation(async function* () {
        yield {
          event: "on_chat_model_stream",
          data: { chunk: { content: "partial" } },
        } as any;
        throw new Error("stream exploded");
      }),
    };
    vi.spyOn((agent as any).telemetry, "trackAgentExecution").mockResolvedValue(
      undefined
    );

    const consume = async () => {
      for await (const _ of agent.streamEvents({ prompt: "doomed" })) {
        void _;
      }
    };
    await expect(consume()).rejects.toThrow("stream exploded");

    // The failed query must not linger in memory as an unanswered HumanMessage,
    // mirroring run()/stream() which only commit history on success
    const orphaned = agent
      .getConversationHistory()
      .filter((m) => m.getType?.() === "human" && m.content === "doomed");
    expect(orphaned).toHaveLength(0);
    expect(agent.getConversationHistory()).toEqual([]);
  });
});
