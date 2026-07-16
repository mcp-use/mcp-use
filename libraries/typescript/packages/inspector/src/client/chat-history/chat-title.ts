import { completeChat, providerConfigFromOptions } from "@mcp-use/agent";
import type { Message, LLMConfig } from "@/client/components/chat/types";

/** Placeholder title for new chats; must match storage default and cloud DB default. */
export const CHAT_TITLE_PLACEHOLDER = "New Chat";

/** Short title when the first message has no concrete topic yet. */
export const CHAT_TITLE_SIMPLE = "Chat";

export function isPlaceholderTitle(title: string): boolean {
  return title === CHAT_TITLE_PLACEHOLDER || title === CHAT_TITLE_SIMPLE;
}

const SYSTEM_PROMPT =
  "Generate a concise title (maximum 60 characters) for this chat based on the user's first message. " +
  "Name the subject matter, task, or question — not the act of chatting. " +
  "Never output meta phrases (e.g. do not use: greeting, introduction, initiation, conversation start, chat session). " +
  "If there is no specific topic yet, reply with exactly: Chat. " +
  "Return only the title, no quotes or extra text.";

const META_TITLE_SUBSTRINGS = [
  "greeting",
  "initiation",
  "conversation start",
  "introduction to",
  "chat session",
  "starting a chat",
  "beginning of",
] as const;

function messageText(message: Message): string {
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  return String(message.content ?? "").trim();
}

export function firstUserMessageFromMessages(
  messages: Message[]
): string | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = messageText(message);
    if (text) return text;
  }
  return null;
}

function looksLikeMetaChatTitle(title: string): boolean {
  const lower = title.toLowerCase();
  for (const substring of META_TITLE_SUBSTRINGS) {
    if (lower.includes(substring)) return true;
  }
  return false;
}

function isGreetingOnlyMessage(message: string): boolean {
  const line = message.trim().split(/\r?\n/)[0]!.trim();
  if (!line) return true;
  if (line.length > 48) return false;
  const normalized = line.replace(/\s+/g, " ").toLowerCase();
  return (
    /^(hi|hello|hey|greetings?)[!.]?$/i.test(normalized) ||
    /^(good morning|good afternoon|good evening)[!.]?$/i.test(normalized) ||
    /^(hi|hello|hey)\s+(there|all|team|everyone)[!.]?$/i.test(normalized)
  );
}

function capTitle(text: string): string {
  return text.length > 60 ? `${text.substring(0, 57)}...` : text;
}

function hasUsableLlmConfig(llmConfig: LLMConfig | null | undefined): boolean {
  if (!llmConfig?.model?.trim()) return false;
  if (llmConfig.provider === "ollama") return true;
  return Boolean(llmConfig.apiKey?.trim());
}

/** Generate a concise title from the first user message using the connected LLM. */
export async function generateChatTitleWithLlm(
  llmConfig: LLMConfig,
  message: string,
  signal?: AbortSignal
): Promise<string | null> {
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (!hasUsableLlmConfig(llmConfig)) return null;

  if (isGreetingOnlyMessage(trimmed)) {
    return capTitle(trimmed);
  }

  try {
    const providerConfig = providerConfigFromOptions(
      llmConfig.provider,
      llmConfig.model,
      {
        apiKey: llmConfig.apiKey,
        temperature: llmConfig.temperature,
        baseUrl: llmConfig.baseUrl,
        maxTokens: 128,
      }
    );

    const text = (
      await completeChat({
        config: providerConfig,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: trimmed },
        ],
        signal,
      })
    ).trim();

    if (!text) return null;
    const capped = capTitle(text);
    if (capped === CHAT_TITLE_SIMPLE || looksLikeMetaChatTitle(capped)) {
      return capTitle(trimmed);
    }
    return capped;
  } catch {
    return null;
  }
}
