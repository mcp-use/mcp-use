import { describe, expect, it } from "vitest";
import {
  selectAppToolConnections,
  selectModelContexts,
  type WidgetInfo,
} from "../WidgetDebugContext";

function widget(
  scope: string | undefined,
  text: string,
  extras: Partial<WidgetInfo> = {}
): WidgetInfo {
  return {
    toolName: text,
    protocol: "mcp-apps",
    modelContextScope: scope,
    cspViolations: [],
    modelContext: { content: [{ type: "text", text }] },
    ...extras,
  };
}

describe("selectModelContexts", () => {
  it("returns only contexts from the requested Chat surface", () => {
    const widgets = new Map<string, WidgetInfo>([
      ["chat-widget", widget("chat:server-a", "chat state")],
      ["other-chat", widget("chat:server-b", "other state")],
      ["tools-widget", widget("tools:server-a", "tools state")],
    ]);

    expect([...selectModelContexts(widgets, "chat:server-a").keys()]).toEqual([
      "chat-widget",
    ]);
  });

  it("drops a context as soon as its widget is removed", () => {
    const widgets = new Map<string, WidgetInfo>([
      ["chat-widget", widget("chat:server-a", "chat state")],
    ]);
    widgets.delete("chat-widget");
    expect(selectModelContexts(widgets, "chat:server-a").size).toBe(0);
  });
});

describe("selectAppToolConnections", () => {
  it("returns only app tools from the active chat scope", () => {
    const callTool = async () => ({ content: [] });
    const widgets = new Map<string, WidgetInfo>([
      [
        "chat-widget",
        widget("chat:server-a", "chat app", {
          appToolConnection: {
            tools: [
              {
                name: "app_ping",
                inputSchema: { type: "object", properties: {} },
              },
            ],
            callTool,
          },
        }),
      ],
      [
        "other-chat",
        widget("chat:server-b", "other app", {
          appToolConnection: {
            tools: [
              {
                name: "other_ping",
                inputSchema: { type: "object", properties: {} },
              },
            ],
            callTool,
          },
        }),
      ],
      ["tools-widget", widget(undefined, "tools")],
    ]);

    expect(
      selectAppToolConnections(widgets, "chat:server-a").flatMap((connection) =>
        connection.tools.map((tool) => tool.name)
      )
    ).toEqual(["app_ping"]);
  });
});
