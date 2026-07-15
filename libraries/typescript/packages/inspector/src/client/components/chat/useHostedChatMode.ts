import { useState } from "react";
import type { LLMConfig } from "./types";

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
  const [forceClientSide, setForceClientSide] = useState(() =>
    hostUsesServerManagedStream ? false : !!localLlmConfig
  );
  const effectiveClientSide = hostUsesServerManagedStream
    ? forceClientSide
    : useClientSide || forceClientSide || !!localLlmConfig;
  const llmConfig = effectiveClientSide
    ? localLlmConfig
    : (managedLlmConfig ?? localLlmConfig);
  const isManaged = !effectiveClientSide && !!managedLlmConfig;

  return {
    forceClientSide,
    setForceClientSide,
    effectiveClientSide,
    llmConfig,
    isManaged,
    hostUsesServerManagedStream,
  };
}
