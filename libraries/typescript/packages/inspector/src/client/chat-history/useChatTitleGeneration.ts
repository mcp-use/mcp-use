import { useEffect, useRef } from "react";
import type { Message, LLMConfig } from "@/client/components/chat/types";
import type { ChatStorageProvider } from "./types";
import {
  CHAT_TITLE_PLACEHOLDER,
  firstUserMessageFromMessages,
  generateChatTitleWithLlm,
  isPlaceholderTitle,
} from "./chat-title";

type UseChatTitleGenerationParams = {
  activeChatId: string | null;
  storage: ChatStorageProvider | null;
  messages: Message[];
  isLoading: boolean;
  effectiveClientSide: boolean;
  llmConfig: LLMConfig | null;
  activeChatTitle?: string;
  titleGenerationReady?: boolean;
  onTitleGenerated?: (chatId: string, title: string) => void;
  onHistoryRefetch?: () => void;
};

export function useChatTitleGeneration({
  activeChatId,
  storage,
  messages,
  isLoading,
  effectiveClientSide,
  llmConfig,
  activeChatTitle,
  titleGenerationReady = true,
  onTitleGenerated,
  onHistoryRefetch,
}: UseChatTitleGenerationParams): void {
  const requestedFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    requestedFingerprintRef.current = null;
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId || !storage || isLoading || !titleGenerationReady) return;
    if (activeChatTitle && !isPlaceholderTitle(activeChatTitle)) return;

    const firstUserMessage = firstUserMessageFromMessages(messages);
    if (!firstUserMessage) return;

    const fingerprint = `${activeChatId}:${firstUserMessage}`;
    if (requestedFingerprintRef.current === fingerprint) return;
    requestedFingerprintRef.current = fingerprint;

    let cancelled = false;

    void (async () => {
      let title: string | null = null;

      if (storage.generateTitle) {
        title = await storage.generateTitle(activeChatId);
      } else if (effectiveClientSide && llmConfig) {
        title = await generateChatTitleWithLlm(llmConfig, firstUserMessage);
        if (title) {
          await storage.updateChat(activeChatId, { title });
        }
      }

      if (cancelled) return;

      if (!title || title === CHAT_TITLE_PLACEHOLDER) {
        requestedFingerprintRef.current = null;
        return;
      }

      onHistoryRefetch?.();
      onTitleGenerated?.(activeChatId, title);
    })().catch(() => {
      if (!cancelled) {
        requestedFingerprintRef.current = null;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeChatId,
    storage,
    messages,
    isLoading,
    effectiveClientSide,
    llmConfig,
    activeChatTitle,
    titleGenerationReady,
    onTitleGenerated,
    onHistoryRefetch,
  ]);
}
