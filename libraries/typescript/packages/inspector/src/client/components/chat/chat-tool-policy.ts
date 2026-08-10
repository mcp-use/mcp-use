import { isToolVisibleToModel } from "@mcp-use/client/react";

export function resolveChatToolPolicy<
  T extends { name: string; _meta?: unknown },
>(
  tools: readonly T[],
  userDisabledTools: ReadonlySet<string>
): {
  modelVisibleTools: T[];
  effectiveDisabledTools: Set<string>;
} {
  const modelVisibleTools: T[] = [];
  const effectiveDisabledTools = new Set(userDisabledTools);

  for (const tool of tools) {
    if (isToolVisibleToModel(tool)) {
      modelVisibleTools.push(tool);
    } else {
      effectiveDisabledTools.add(tool.name);
    }
  }

  return { modelVisibleTools, effectiveDisabledTools };
}
