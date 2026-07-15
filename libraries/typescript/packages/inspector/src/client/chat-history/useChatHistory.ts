import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSession, ChatStorageProvider } from "./types";

const ITEMS_PER_PAGE = 20;

export interface UseChatHistoryOptions {
  provider: ChatStorageProvider;
  enabled?: boolean;
  agentId?: string;
  refetchKey?: number;
  refetchInterval?: number | false;
}

export function useChatHistory({
  provider,
  enabled = true,
  agentId,
  refetchKey,
  refetchInterval = false,
}: UseChatHistoryOptions) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ChatSession[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const prevRefetchKeyRef = useRef<number | undefined>(undefined);

  const fetchChats = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await provider.listChats({
        ...(agentId ? { agentId } : {}),
        take: ITEMS_PER_PAGE * page,
        skip: 0,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [provider, enabled, agentId, page]);

  useEffect(() => {
    if (enabled) {
      setPage(1);
    }
  }, [enabled]);

  useEffect(() => {
    void fetchChats();
  }, [fetchChats]);

  useEffect(() => {
    if (refetchKey !== undefined && refetchKey !== prevRefetchKeyRef.current) {
      prevRefetchKeyRef.current = refetchKey;
      if (enabled) void fetchChats();
    }
  }, [refetchKey, enabled, fetchChats]);

  useEffect(() => {
    if (!enabled || !refetchInterval) return;
    const id = setInterval(() => void fetchChats(), refetchInterval);
    return () => clearInterval(id);
  }, [enabled, refetchInterval, fetchChats]);

  const hasNextPage = total > items.length;

  const loadMore = useCallback(() => {
    if (hasNextPage && !isLoading) {
      setPage((prev) => prev + 1);
    }
  }, [hasNextPage, isLoading]);

  const refetch = useCallback(() => {
    void fetchChats();
  }, [fetchChats]);

  const deleteChat = useCallback(
    async (chatId: string) => {
      await provider.deleteChat(chatId);
      await fetchChats();
    },
    [provider, fetchChats]
  );

  return {
    chats: items,
    total,
    isLoading,
    error,
    hasNextPage,
    loadMore,
    refetch,
    deleteChat,
  };
}
