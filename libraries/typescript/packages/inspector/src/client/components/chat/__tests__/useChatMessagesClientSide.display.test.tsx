// @vitest-environment jsdom
import type { McpServer } from "@mcp-use/client/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatMessagesClientSide } from "../useChatMessagesClientSide";
import { useChatSessions } from "../useChatSessions";

const modelRequests = vi.hoisted(
  () => [] as Array<Array<{ role: string; content: unknown }>>
);

vi.mock("@mcp-use/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mcp-use/agent")>()),
  providerConfigFromOptions: () => ({}),
  MCPAgent: class {
    async *streamEvents({
      messages,
    }: {
      messages: Array<{ role: string; content: unknown }>;
    }) {
      modelRequests.push(messages);
    }
  },
}));

describe("useChatMessagesClientSide model-only content", () => {
  let container: HTMLDivElement;
  let root: Root;
  let chat: ReturnType<typeof useChatMessagesClientSide>;

  function Probe() {
    const sessions = useChatSessions({
      retryServerId: "server-1",
      agentId: "server-1",
      storage: null,
    });
    chat = useChatMessagesClientSide({
      sessionStore: sessions.store,
      sessionId: sessions.activeSessionId,
      onMessagesChange: sessions.persistSessionMessages,
      connection: {
        id: "server-1",
        url: "https://example.test/mcp",
      } as unknown as McpServer,
      llmConfig: { provider: "openai", apiKey: "test-key", model: "m" },
      isConnected: true,
    });
    return null;
  }

  beforeEach(async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    modelRequests.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Probe />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("stores the trimmed display text but sends the full text to the model", async () => {
    await act(async () => {
      await chat.sendMessage("Visible.\nHidden context.", [], undefined, {
        displayContent: " Visible. ",
      });
    });

    expect(chat.messages[0]).toMatchObject({
      role: "user",
      content: "Visible.\nHidden context.",
      displayContent: "Visible.",
    });
    expect(modelRequests).toHaveLength(1);
    expect(modelRequests[0]).toContainEqual(
      expect.objectContaining({
        role: "user",
        content: "Visible.\nHidden context.",
      })
    );
  });

  it("leaves displayContent unset for ordinary messages", async () => {
    await act(async () => {
      await chat.sendMessage("Hello", []);
    });
    expect(chat.messages[0]).not.toHaveProperty("displayContent");
  });
});
