import { describe, expect, it } from "vitest";
import type { WidgetInfo } from "@/client/context/WidgetDebugContext";
import { buildChatCspAudit } from "../csp-bridge";

describe("buildChatCspAudit", () => {
  it("reports a clean widget in widget-declared mode", () => {
    const widgets = new Map<string, WidgetInfo>([
      [
        "call-1",
        {
          toolName: "show-weather",
          protocol: "mcp-apps",
          declaredCsp: {
            connectDomains: ["https://api.example.com"],
            resourceDomains: [],
          },
          effectivePolicy: "connect-src 'self' https://api.example.com",
          cspViolations: [],
        },
      ],
    ]);

    expect(buildChatCspAudit("widget-declared", widgets)).toMatchObject({
      mode: "widget-declared",
      clean: true,
      widgets: [
        {
          widgetId: "call-1",
          toolName: "show-weather",
          violations: [],
        },
      ],
    });
  });

  it("returns the exact origin suggestion for a blocked connection", () => {
    const widgets = new Map<string, WidgetInfo>([
      [
        "call-2",
        {
          toolName: "show-weather",
          protocol: "mcp-apps",
          cspViolations: [
            {
              directive: "connect-src",
              effectiveDirective: "connect-src",
              blockedUri: "https://api.example.com/weather",
              timestamp: 1,
            },
          ],
        },
      ],
    ]);

    const audit = buildChatCspAudit("widget-declared", widgets);
    expect(audit.clean).toBe(false);
    expect(audit.widgets[0]?.suggestedFix?.connectDomains).toEqual([
      "https://api.example.com",
      "wss://api.example.com",
    ]);
    expect(audit.widgets[0]?.agentPrompt).toContain("https://api.example.com");
  });

  it("does not mark an undeclared widget policy clean", () => {
    const widgets = new Map<string, WidgetInfo>([
      [
        "call-3",
        {
          toolName: "show-local-card",
          protocol: "mcp-apps",
          cspViolations: [],
        },
      ],
    ]);

    const audit = buildChatCspAudit("widget-declared", widgets);
    expect(audit.clean).toBe(false);
    expect(audit.widgets[0]?.findings[0]?.title).toBe("No widget CSP declared");
  });

  it("audits an explicit widget or the newest widget by default", () => {
    const widgets = new Map<string, WidgetInfo>([
      [
        "old-call",
        {
          toolName: "old-tool",
          protocol: "mcp-apps",
          cspViolations: [],
        },
      ],
      [
        "new-call",
        {
          toolName: "new-tool",
          protocol: "mcp-apps",
          declaredCsp: { connectDomains: [], resourceDomains: [] },
          cspViolations: [],
        },
      ],
    ]);

    expect(
      buildChatCspAudit("widget-declared", widgets).widgets[0]?.widgetId
    ).toBe("new-call");
    expect(
      buildChatCspAudit("widget-declared", widgets, "old-call").widgets[0]
        ?.widgetId
    ).toBe("old-call");
  });
});
