import { useCallback, useEffect, useState } from "react";
import type { ChatSystemPromptProvider } from "./types";
import {
  getSystemPromptStorageKey,
  readStoredSystemPrompt,
  writeStoredSystemPrompt,
} from "./local-storage";

export function useLocalSystemPrompt(
  serverId: string
): ChatSystemPromptProvider {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const storageKey = getSystemPromptStorageKey(serverId);

  useEffect(() => {
    const load = () => {
      setPrompt(readStoredSystemPrompt(serverId));
    };
    load();

    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [serverId, storageKey]);

  const savePrompt = useCallback(
    async (next: string) => {
      setIsSaving(true);
      try {
        writeStoredSystemPrompt(serverId, next);
        setPrompt(next);
      } finally {
        setIsSaving(false);
      }
    },
    [serverId]
  );

  return {
    prompt,
    savePrompt,
    isSaving,
  };
}
