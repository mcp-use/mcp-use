/**
 * Browser client example: tool calls, onSampling, onElicitation, onNotification
 *
 * Uses BrowserMCPClient from mcp-use/browser. Callbacks are passed per-server.
 * Same behavior as the Node full-features example; runnable with tsx in Node.
 *
 * Prerequisites: Conformance server on port 3000.
 * Run: npx tsx examples/client/browser/full-features-example.ts
 */

import {
  acceptWithDefaults,
  type OnElicitationCallback,
  type OnNotificationCallback,
  type OnSamplingCallback,
} from "mcp-use";
import { MCPClient as BrowserMCPClient } from "mcp-use/browser";

const SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000/mcp";

function log(label: string, ...args: unknown[]) {
  console.log(`[${label}]`, ...args);
}

const onSampling: OnSamplingCallback = async (params) => {
  log("onSampling", "messages:", params.messages?.length ?? 0);
  const lastMessage = params.messages?.[params.messages.length - 1];
  const content = Array.isArray(lastMessage?.content)
    ? lastMessage.content[0]
    : lastMessage?.content;
  const textContent =
    content && typeof content === "object" && "text" in content
      ? (content as { text: string }).text
      : "Hello from mock LLM";
  log("onSampling", "responding with:", textContent.slice(0, 50) + "...");
  return {
    role: "assistant",
    content: { type: "text", text: textContent },
    model: "mock-llm-v1",
    stopReason: "endTurn",
  };
};

const onElicitation: OnElicitationCallback = async (params) => {
  log("onElicitation", "request received");
  const result = acceptWithDefaults(params);
  log("onElicitation", "accept with content:", result.content);
  return result;
};

const onNotification: OnNotificationCallback = (notification) => {
  log("onNotification", notification.method, notification.params ?? "");
};

async function main(): Promise<void> {
  console.log("Browser full-features example");
  console.log("Server:", SERVER_URL);
  console.log("");

  const client = new BrowserMCPClient({
    clientInfo: {
      name: "browser-full-features-example",
      version: "1.0.0",
    },
    mcpServers: {
      conformance: {
        url: SERVER_URL,
        onSampling,
        onElicitation,
        onNotification,
      },
    },
  });

  try {
    log("connect", "creating session...");
    const session = await client.createSession("conformance");
    log("connect", "connected");

    const tools = await session.listTools();
    log("tools", `listed ${tools.length} tools`);

    const toCall = [
      "test_simple_text",
      "test_sampling",
      "test_elicitation",
      "test_elicitation_sep1034_defaults",
      "test_tool_with_logging",
    ];

    for (const name of toCall) {
      if (!tools.some((t) => t.name === name)) {
        log("skip", `tool ${name} not found`);
        continue;
      }
      try {
        const args = name === "test_simple_text" ? { message: "Hi" } : {};
        const result = await session.callTool(name, args);
        const textPart = Array.isArray(result.content)
          ? result.content.find((c: { type?: string }) => c.type === "text")
          : result.content;
        const snippet =
          textPart && typeof textPart === "object" && "text" in textPart
            ? String((textPart as { text: string }).text).slice(0, 60)
            : JSON.stringify(result).slice(0, 60);
        log("tool", name, "->", snippet + (snippet.length >= 60 ? "..." : ""));
      } catch (err) {
        log("tool", name, "error:", (err as Error).message);
      }
    }

    console.log("");
    log("done", "all steps completed");
  } finally {
    await client.closeAllSessions();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
