/**
 * Free-tier upgrade prompt visibility.
 *
 * The hosted inspector (inspector.manufact.com) shows a "Sign in to increase
 * your limits" CTA for anonymous visitors using Manufact's managed LLM. It must
 * NOT be shown to users who are already signed in — otherwise signed-in users
 * keep getting asked to log in (MCP-2142).
 *
 * Pure decision so it can be unit-tested without rendering React.
 */
import type { LLMConfig } from "./types";

export const FALLBACK_MANAGED_MODEL_ID = "openai/gpt-5.6-luna";

interface FreeTierVisibilityInput {
  /** Chat is using the server-managed (Manufact) LLM, not a BYOK key. */
  isManaged: boolean;
  /** Host opted into the free-tier sign-in/upgrade UI (hosted inspector only). */
  enableFreeTierUpgrade: boolean;
  /** Visitor is signed in to Manufact (shared session cookie resolved). */
  isAuthenticated: boolean;
}

export function shouldShowFreeTierUpgrade({
  isManaged,
  enableFreeTierUpgrade,
  isAuthenticated,
}: FreeTierVisibilityInput): boolean {
  return isManaged && enableFreeTierUpgrade && !isAuthenticated;
}

/** True when localhost MCP should use browser MCPAgent + cloud LLM proxy. */
export function shouldUseManagedClientSide({
  isLoopback,
  chatApiUrl,
}: {
  isLoopback: boolean;
  chatApiUrl?: string;
  enableFreeTierUpgrade?: boolean;
}): boolean {
  return isLoopback && !!chatApiUrl;
}

/** LLM config for the managed inspector LLM proxy (`/inspector/llm/*`). */
export function buildManagedLlmProxyConfig(
  chatApiUrl: string,
  accessToken?: string | null,
  useSession = false,
  modelId?: string
): LLMConfig {
  const baseUrl = chatApiUrl.replace(/\/chat\/stream\/?$/, "/llm");
  return {
    provider: "openai-compatible",
    model: modelId ?? FALLBACK_MANAGED_MODEL_ID,
    apiKey: accessToken ?? "server-managed",
    baseUrl,
    ...(useSession ? { credentials: "include" as const } : {}),
  };
}

export function buildManagedAuthHeaders(
  accessToken?: string | null
): Record<string, string> | undefined {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
}
