export const MODEL_TOOL_LIMITS = {
  openai: 128,
  google: 128,
} as const;

export interface ToolLimitWarning {
  limit: number;
  toolCount: number;
}

/**
 * Returns a warning only for providers with a documented hard tool limit.
 * Anthropic does not document a comparable cap for the Messages API.
 */
export function getToolLimitWarning(
  provider: string | null | undefined,
  toolCount: number
): ToolLimitWarning | null {
  const normalizedProvider = provider?.trim().toLowerCase();
  if (normalizedProvider !== "openai" && normalizedProvider !== "google") {
    return null;
  }

  const limit = MODEL_TOOL_LIMITS[normalizedProvider];
  return toolCount > limit ? { limit, toolCount } : null;
}
