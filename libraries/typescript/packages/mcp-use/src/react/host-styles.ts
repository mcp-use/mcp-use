import type { HostContext } from "./widget-types.js";

const CUSTOM_PROPERTY_NAME = /^--[A-Za-z0-9_-]+$/;

export function applyHostStyleVariables(
  hostContext: HostContext | undefined,
  options?: { source?: string; hostName?: string }
): void {
  if (typeof document === "undefined" || !hostContext) return;

  const variables = hostContext?.styles?.variables;
  const entries = variables ? Object.entries(variables) : [];
  const root = document.documentElement;
  const applied: Record<string, string> = {};
  const skipped: Record<string, string> = {};

  for (const [name, value] of entries) {
    if (!CUSTOM_PROPERTY_NAME.test(name)) {
      skipped[name] = value;
      continue;
    }

    root.style.setProperty(name, value);
    applied[name] = root.style.getPropertyValue(name);
  }

  const computed = Object.fromEntries(
    Object.keys(applied).map((name) => [
      name,
      getComputedStyle(root).getPropertyValue(name),
    ])
  );

  console.log("[mcp-use host context]", {
    source: options?.source ?? "theme-provider",
    hostName: options?.hostName,
    variableCount: entries.length,
    hostContext: hostContext ?? null,
    applied,
    skipped,
    computed,
    documentTheme: root.getAttribute("data-theme"),
    documentClass: root.className,
  });
}
