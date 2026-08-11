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
  lockManagedMode,
}: {
  useClientSide: boolean;
  managedLlmConfig?: LLMConfig | null;
  localLlmConfig: LLMConfig | null;
  lockManagedMode?: boolean;
}) {
  const hostUsesServerManagedStream =
    !useClientSide && managedLlmConfig != null;
  const [forceClientSide, setForceClientSideState] = useState(() => {
    return resolveInitialForceClientSide(
      hostUsesServerManagedStream,
      localLlmConfig,
      lockManagedMode
    );
  });

  const setForceClientSide = useCallback(
    (value: boolean) => {
      if (lockManagedMode && hostUsesServerManagedStream) return;
      writeStoredChatMode(value ? "byok" : "managed");
      setForceClientSideState(value);
    },
    [hostUsesServerManagedStream, lockManagedMode]
  );

  const effectiveClientSide = hostUsesServerManagedStream
    ? lockManagedMode
      ? false
      : forceClientSide
    : useClientSide || forceClientSide || !!localLlmConfig;
  const isManaged =
    !!managedLlmConfig && (lockManagedMode === true || !forceClientSide);
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
