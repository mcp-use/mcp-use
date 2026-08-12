import type {
  PlaygroundSettings,
  WidgetInfo,
} from "@/client/context/WidgetDebugContext";
import { diagnoseCsp } from "@/client/mcp-apps/csp";
import {
  buildAgentCspPrompt,
  computeSuggestedFix,
} from "@/client/mcp-apps/debug/csp-suggestions";

export interface ChatCspAuditWidget {
  widgetId: string;
  toolName: string;
  declaredCsp: WidgetInfo["declaredCsp"];
  effectivePolicy?: string;
  violations: WidgetInfo["cspViolations"];
  findings: ReturnType<typeof diagnoseCsp>;
  suggestedFix: ReturnType<typeof computeSuggestedFix> | null;
  agentPrompt: string;
}

export interface ChatCspAudit {
  mode: PlaygroundSettings["cspMode"];
  widgets: ChatCspAuditWidget[];
  clean: boolean;
}

export function buildChatCspAudit(
  mode: PlaygroundSettings["cspMode"],
  widgets: ReadonlyMap<string, WidgetInfo>,
  widgetId?: string
): ChatCspAudit {
  const entries = Array.from(widgets.entries());
  const selectedEntries = widgetId
    ? entries.filter(([candidateId]) => candidateId === widgetId)
    : entries.slice(-1);
  const audited = selectedEntries.map(([selectedWidgetId, widget]) => {
    const violations = widget.cspViolations;
    const suggestedFix =
      violations.length > 0
        ? computeSuggestedFix(violations, widget.declaredCsp)
        : null;
    return {
      widgetId: selectedWidgetId,
      toolName: widget.toolName,
      declaredCsp: widget.declaredCsp,
      effectivePolicy: widget.effectivePolicy,
      violations,
      findings: diagnoseCsp({
        mode,
        declared: widget.declaredCsp,
        effectivePolicy: widget.effectivePolicy,
        violations,
      }),
      suggestedFix,
      agentPrompt:
        violations.length > 0
          ? buildAgentCspPrompt(
              widget.declaredCsp,
              widget.effectivePolicy,
              violations,
              suggestedFix
            )
          : "",
    } satisfies ChatCspAuditWidget;
  });

  return {
    mode,
    widgets: audited,
    clean:
      mode === "widget-declared" &&
      audited.length > 0 &&
      audited.every(
        (widget) =>
          widget.violations.length === 0 &&
          widget.findings.every((finding) => finding.severity === "info")
      ),
  };
}
