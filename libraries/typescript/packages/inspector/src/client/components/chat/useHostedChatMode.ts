import { useCallback, useState } from "react";
import type { LLMConfig } from "./types";
import {
  resolveInitialForceClientSide,
  writeStoredChatMode,
} from "./chatModeStorage";

export function useHostedChatMode({
  useClientSide,
  managedLlmConfig,
  localLlmConfig,
}: {
  useClientSide: boolean;
  managedLlmConfig?: LLMConfig | null;
  localLlmConfig: LLMConfig | null;
}) {
  const hostUsesServerManagedStream =
    !useClientSide && managedLlmConfig != null;
  const [forceClientSide, setForceClientSideState] = useState(() => {
    return resolveInitialForceClientSide(
      hostUsesServerManagedStream,
      localLlmConfig
    );
  });

  const setForceClientSide = useCallback((value: boolean) => {
    writeStoredChatMode(value ? "byok" : "managed");
    setForceClientSideState(value);
  }, []);

  const effectiveClientSide = hostUsesServerManagedStream
    ? forceClientSide
    : useClientSide || forceClientSide || !!localLlmConfig;
  const isManaged = !!managedLlmConfig && !forceClientSide;
  const llmConfig: LLMConfig | null = isManaged
    ? (managedLlmConfig ?? null)
    : (localLlmConfig ?? managedLlmConfig ?? null);

  return {
    forceClientSide,
    setForceClientSide,
    effectiveClientSide,
    llmConfig,
    isManaged,
    hostUsesServerManagedStream,
  };
}
