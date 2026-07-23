import { describe, expect, it } from "vitest";
import { selectModelContexts, type WidgetInfo } from "../WidgetDebugContext";

function widget(scope: string, text: string): WidgetInfo {
  return {
    toolName: text,
    protocol: "mcp-apps",
    modelContextScope: scope,
    cspViolations: [],
    modelContext: { content: [{ type: "text", text }] },
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
