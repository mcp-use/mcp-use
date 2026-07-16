import { DEFAULT_CHAT_SYSTEM_PROMPT } from "../system-prompt-default";

export function getSystemPromptStorageKey(serverId: string): string {
  return `mcp-inspector-system-prompt:${serverId}`;
}

export function readStoredSystemPrompt(serverId: string): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(getSystemPromptStorageKey(serverId));
}

export function writeStoredSystemPrompt(
  serverId: string,
  prompt: string
): void {
  localStorage.setItem(getSystemPromptStorageKey(serverId), prompt);
}

export function resolveSystemPrompt(stored: string | null | undefined): string {
  const trimmed = stored?.trim();
  return trimmed || DEFAULT_CHAT_SYSTEM_PROMPT;
}
