export const CHAT_MODE_STORAGE_KEY = "mcp-inspector:chat-mode";

export type ChatMode = "byok" | "managed";

export function readStoredChatMode(): ChatMode | null {
  try {
    const value = localStorage.getItem(CHAT_MODE_STORAGE_KEY);
    if (value === "byok" || value === "managed") return value;
  } catch {
    // ponytail: ignore quota / private mode
  }
  return null;
}

export function writeStoredChatMode(mode: ChatMode): void {
  try {
    localStorage.setItem(CHAT_MODE_STORAGE_KEY, mode);
  } catch {
    // ponytail: ignore quota / private mode
  }
}

export function clearStoredChatMode(): void {
  try {
    localStorage.removeItem(CHAT_MODE_STORAGE_KEY);
  } catch {
    // ponytail: ignore quota / private mode
  }
}

/** Sync read for useState initializers (before localLlmConfig loads from useEffect). */
export function resolveInitialForceClientSide(
  hostUsesServerManagedStream: boolean,
  localLlmConfig: { provider: string; model: string } | null
): boolean {
  const stored = readStoredChatMode();
  if (stored === "byok") return true;
  if (stored === "managed") return false;
  if (hostUsesServerManagedStream) return false;
  // Legacy: BYOK config saved before chat-mode key existed
  try {
    if (localStorage.getItem("mcp-inspector-llm-config")) return true;
  } catch {
    // ponytail: ignore
  }
  return !!localLlmConfig;
}
