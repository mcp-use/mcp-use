import { useCallback, useEffect, useState } from "react";
import { buildManagedAuthHeaders, FALLBACK_MANAGED_MODEL_ID } from "./freeTier";

export interface CloudModel {
  id: string;
  name: string;
  provider: string;
}

const STORAGE_KEY_PREFIX = "mcp-inspector:managed-model";

function storageKey(origin: string): string {
  return `${STORAGE_KEY_PREFIX}:${origin}`;
}

function readStoredModel(origin: string): string | null {
  try {
    return localStorage.getItem(storageKey(origin));
  } catch {
    return null;
  }
}

export function useManagedCloudModel(
  chatApiUrl: string | undefined,
  accessToken: string | null | undefined,
  authMode: "session" | "oauth" | null,
  enabled: boolean
) {
  const origin = chatApiUrl ? new URL(chatApiUrl).origin : null;
  const [models, setModels] = useState<CloudModel[]>([]);
  const [defaultModelId, setDefaultModelId] = useState(
    FALLBACK_MANAGED_MODEL_ID
  );
  const [selectedModelId, setSelectedModelIdState] = useState(() =>
    origin
      ? (readStoredModel(origin) ?? FALLBACK_MANAGED_MODEL_ID)
      : FALLBACK_MANAGED_MODEL_ID
  );
  const [isLoading, setIsLoading] = useState(false);

  const setSelectedModelId = useCallback(
    (id: string) => {
      setSelectedModelIdState(id);
      if (origin) {
        try {
          localStorage.setItem(storageKey(origin), id);
        } catch {
          // ponytail: ignore quota errors
        }
      }
    },
    [origin]
  );

  useEffect(() => {
    if (!enabled || !origin) return;
    let cancelled = false;
    setIsLoading(true);
    void (async () => {
      try {
        const headers = buildManagedAuthHeaders(accessToken);
        const response = await fetch(`${origin}/api/v1/models`, {
          headers,
          credentials: authMode === "session" ? "include" : "same-origin",
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          models?: CloudModel[];
          defaultModelId?: string;
        };
        if (cancelled) return;
        const list = data.models ?? [];
        setModels(list);
        const nextDefault = data.defaultModelId ?? FALLBACK_MANAGED_MODEL_ID;
        setDefaultModelId(nextDefault);
        const ids = new Set(list.map((m) => m.id));
        const stored = readStoredModel(origin);
        if (stored && ids.has(stored)) {
          setSelectedModelIdState(stored);
        } else if (ids.has(nextDefault)) {
          setSelectedModelIdState(nextDefault);
        } else if (list[0]) {
          setSelectedModelIdState(list[0].id);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, origin, accessToken, authMode]);

  const selectedModel = models.find((m) => m.id === selectedModelId) ?? null;

  return {
    models,
    selectedModelId,
    setSelectedModelId,
    isLoading,
    selectedModel,
    defaultModelId,
  };
}
