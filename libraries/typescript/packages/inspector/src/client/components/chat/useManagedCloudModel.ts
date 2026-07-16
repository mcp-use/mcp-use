import { useCallback, useEffect, useState } from "react";
import {
  buildManagedAuthHeaders,
  FALLBACK_MANAGED_MODEL_ID,
} from "./freeTier";

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
  const [defaultModelId, setDefaultModelId] = useState(FALLBACK_MANAGED_MODEL_ID);
  const [selectedModelId, setSelectedModelIdState] = useState(() =>
    origin ? (readStoredModel(origin) ?? FALLBACK_MANAGED_MODEL_ID) : FALLBACK_MANAGED_MODEL_ID
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
    // #region agent log
    fetch('http://127.0.0.1:7371/ingest/4e7482c5-571f-4071-bd09-762c357289f4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'243e61'},body:JSON.stringify({sessionId:'243e61',location:'useManagedCloudModel.ts:effect',message:'models fetch gate',data:{enabled,origin,authMode,hasAccessToken:!!accessToken,chatApiUrl:chatApiUrl??null},timestamp:Date.now(),hypothesisId:'H-B'})}).catch(()=>{});
    // #endregion
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
        // #region agent log
        fetch('http://127.0.0.1:7371/ingest/4e7482c5-571f-4071-bd09-762c357289f4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'243e61'},body:JSON.stringify({sessionId:'243e61',location:'useManagedCloudModel.ts:fetch',message:'models fetch result',data:{status:response.status,ok:response.ok,origin,authMode,hasAuthHeader:!!headers?.Authorization},timestamp:Date.now(),hypothesisId:'H-A'})}).catch(()=>{});
        // #endregion
        if (!response.ok) return;
        const data = (await response.json()) as {
          models?: CloudModel[];
          defaultModelId?: string;
        };
        // #region agent log
        fetch('http://127.0.0.1:7371/ingest/4e7482c5-571f-4071-bd09-762c357289f4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'243e61'},body:JSON.stringify({sessionId:'243e61',location:'useManagedCloudModel.ts:parse',message:'models payload',data:{modelCount:(data.models??[]).length,defaultModelId:data.defaultModelId??null},timestamp:Date.now(),hypothesisId:'H-D'})}).catch(()=>{});
        // #endregion
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
