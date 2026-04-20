import type { LLMConfig, StreamProtocol } from "@/client/components/chat/types";
import type { ReactNode } from "react";
import { createContext, use, useCallback, useState } from "react";

export type TabType =
  | "tools"
  | "prompts"
  | "resources"
  | "chat"
  | "sampling"
  | "elicitation"
  | "notifications";

/**
 * Configuration injected by a host application when the inspector runs in
 * embedded / hosted mode (e.g. inside inspector.manufact.com or the Vibe IDE).
 *
 * ── Hosted-inspector chat flow ──────────────────────────────────────────────
 * When `chatApiUrl` is set (baked in at build time via VITE_MANUFACT_CHAT_URL),
 * the Chat tab switches from client-side LLM calls to a managed backend:
 *
 *   1. `InspectorProvider` (below) reads VITE_MANUFACT_CHAT_URL and sets
 *      `chatApiUrl`, `chatStreamProtocol: "data-stream"`, and
 *      `chatCredentials: "include"` so the session cookie is forwarded.
 *
 *   2. `LayoutContent` passes these down to `ChatTab` as props; `ChatTab`
 *      then passes `useClientSide={false}` to `useChatMessages`.
 *
 *   3. If the user already has their own API key in localStorage, `ChatTab`
 *      overrides this with `effectiveClientSide=true` (see forceClientSide
 *      logic there), bypassing the backend entirely.
 *
 *   4. The backend endpoint (`/api/v1/inspector/chat/stream`, cloud.mcp-use)
 *      applies a two-tier rate limit for unauthenticated visitors and skips
 *      it for users whose session cookie is present (shared across
 *      *.manufact.com via COOKIE_DOMAIN=.manufact.com).
 *
 *   5. On a 429 response the frontend shows `LoginModal`, which offers
 *      sign-in (Manufact account) OR falling back to the user's own API key.
 *
 * ── Related files ────────────────────────────────────────────────────────────
 *  • cloud.mcp-use/src/routes/v1/inspector-chat.ts   — rate-limited endpoint
 *  • cloud.mcp-use/src/lib/mcp-chat-stream.ts        — shared OpenRouter streamer
 *  • inspector/src/client/components/ChatTab.tsx      — effectiveClientSide logic
 *  • inspector/src/client/components/LoginModal.tsx   — rate-limit UI
 *  • inspector/src/client/components/HostedUserMenu.tsx — avatar / session check
 */
export interface EmbeddedConfig {
  backgroundColor?: string;
  padding?: string;
  /** Show only a single tab with no tab bar / header chrome */
  singleTab?: boolean;
  /** Which tabs to show. If omitted, all tabs are visible. */
  visibleTabs?: TabType[];
  /** Override the default tab to open on load */
  defaultTab?: TabType;
  /** Custom API URL for the Chat tab's server-side streaming */
  chatApiUrl?: string;
  /**
   * Wire protocol for the `chatApiUrl` streaming endpoint.
   * - `"sse"` (default): Inspector SSE protocol
   * - `"data-stream"`: Vercel AI SDK data-stream protocol
   */
  chatStreamProtocol?: StreamProtocol;
  /**
   * Credentials policy for chat fetch requests.
   * Set to `"include"` when the chat endpoint requires session cookies (e.g. when the
   * inspector iframe is on a subdomain that shares cookies with the API).
   */
  chatCredentials?: RequestCredentials;
  /** Externally-managed LLM config passed to ChatTab (bypasses config UI) */
  managedLlmConfig?: LLMConfig;
  // --- Chat UI customization ---
  /** Hide the "Chat" title in the header */
  chatHideTitle?: boolean;
  /** Hide the model badge on the landing form and header */
  chatHideModelBadge?: boolean;
  /** Hide the MCP server URL on the landing form */
  chatHideServerUrl?: boolean;
  /** Hide the API key / provider configuration dialog */
  chatHideConfigButton?: boolean;
  /** Custom label for the clear / new-chat button */
  chatClearButtonLabel?: string;
  /** Hide the icon on the clear / new-chat button */
  chatClearButtonHideIcon?: boolean;
  /** Hide the keyboard shortcut (⌘O) on the clear / new-chat button */
  chatClearButtonHideShortcut?: boolean;
  /** Button variant for the clear / new-chat button (e.g. "secondary", "ghost") */
  chatClearButtonVariant?: "default" | "secondary" | "ghost" | "outline";
  /** Initial quick questions shown below the landing input. */
  chatQuickQuestions?: string[];
  /** Initial followup suggestions shown above input in chat mode. */
  chatFollowups?: string[];
  /** When true, hides the "New Chat" / clear button in the chat header. */
  chatHideClearButton?: boolean;
  /** When true, hides the tool selector (wrench icon) in the chat input. */
  chatHideToolSelector?: boolean;
  /**
   * When true, treat the chat as already connected even when no MCP server is
   * selected. Use this together with `chatApiUrl` when the backend manages the
   * MCP connections and no client-side server URL is required.
   */
  forceConnected?: boolean;
}

interface InspectorState {
  selectedServerId: string | null;
  activeTab: TabType;
  selectedToolName: string | null;
  selectedPromptName: string | null;
  selectedResourceUri: string | null;
  selectedSamplingRequestId: string | null;
  selectedElicitationRequestId: string | null;
  tunnelUrl: string | null;
  isTunnelStarting: boolean;
  isEmbedded: boolean;
  embeddedConfig: EmbeddedConfig;
}

interface InspectorContextType extends InspectorState {
  setSelectedServerId: (serverId: string | null) => void;
  setActiveTab: (tab: TabType) => void;
  setSelectedToolName: (toolName: string | null) => void;
  setSelectedPromptName: (promptName: string | null) => void;
  setSelectedResourceUri: (resourceUri: string | null) => void;
  setSelectedSamplingRequestId: (requestId: string | null) => void;
  setSelectedElicitationRequestId: (requestId: string | null) => void;
  setTunnelUrl: (tunnelUrl: string | null) => void;
  setIsTunnelStarting: (starting: boolean) => void;
  setEmbeddedMode: (isEmbedded: boolean, config?: EmbeddedConfig) => void;
  navigateToItem: (
    serverId: string,
    tab: TabType,
    itemIdentifier?: string
  ) => void;
  clearSelection: () => void;
}

const InspectorContext = createContext<InspectorContextType | undefined>(
  undefined
);

/**
 * Provides Inspector context and state to descendant components.
 *
 * Initializes and supplies the inspector UI state (selected server, active tab,
 * per-tab selections, tunnel URL, and embedded mode/config) along with updater
 * callbacks and navigation/clearing helpers through React context.
 *
 * @param children - Elements that will receive the Inspector context
 * @returns A context provider element that supplies inspector state and mutator functions to its children
 */
export function InspectorProvider({ children }: { children: ReactNode }) {
  // Seed chat config so the hosted inspector (inspector.manufact.com, Railway
  // deploy, etc.) uses the Manufact Claude API automatically. Read from:
  //   1. `window.__MANUFACT_CHAT_URL__` — runtime, injected by the inspector
  //      server from `MANUFACT_CHAT_URL` env var. This is the preferred path
  //      so a single pre-built npm tarball can be configured at deploy time.
  //   2. `VITE_MANUFACT_CHAT_URL` — build-time Vite env, for local dev builds
  //      where you rebuild the client anyway.
  const hostedChatUrl =
    (typeof window !== "undefined"
      ? (window as Window & { __MANUFACT_CHAT_URL__?: string })
          .__MANUFACT_CHAT_URL__
      : undefined) ??
    ((typeof import.meta !== "undefined"
      ? (import.meta as unknown as Record<string, Record<string, string>>).env
          ?.VITE_MANUFACT_CHAT_URL
      : undefined) as string | undefined);

  const [state, setState] = useState<InspectorState>({
    selectedServerId: null,
    activeTab: "tools",
    selectedToolName: null,
    selectedPromptName: null,
    selectedResourceUri: null,
    selectedSamplingRequestId: null,
    selectedElicitationRequestId: null,
    tunnelUrl: null,
    isTunnelStarting: false,
    isEmbedded: false,
    embeddedConfig: hostedChatUrl
      ? {
          chatApiUrl: hostedChatUrl,
          chatStreamProtocol: "data-stream",
          // Include cookies so the backend can recognise authenticated users
          // (session cookie shared across subdomains via COOKIE_DOMAIN).
          chatCredentials: "include" as RequestCredentials,
        }
      : {},
  });

  const setSelectedServerId = useCallback((serverId: string | null) => {
    setState((prev) => ({ ...prev, selectedServerId: serverId }));
  }, []);

  const setActiveTab = useCallback((tab: TabType) => {
    setState((prev) => ({ ...prev, activeTab: tab }));
  }, []);

  const setSelectedToolName = useCallback((toolName: string | null) => {
    setState((prev) => ({ ...prev, selectedToolName: toolName }));
  }, []);

  const setSelectedPromptName = useCallback((promptName: string | null) => {
    setState((prev) => ({ ...prev, selectedPromptName: promptName }));
  }, []);

  const setSelectedResourceUri = useCallback((resourceUri: string | null) => {
    setState((prev) => ({ ...prev, selectedResourceUri: resourceUri }));
  }, []);

  const setSelectedSamplingRequestId = useCallback(
    (requestId: string | null) => {
      setState((prev) => ({ ...prev, selectedSamplingRequestId: requestId }));
    },
    []
  );

  const setSelectedElicitationRequestId = useCallback(
    (requestId: string | null) => {
      setState((prev) => ({
        ...prev,
        selectedElicitationRequestId: requestId,
      }));
    },
    []
  );

  const setTunnelUrl = useCallback((tunnelUrl: string | null) => {
    setState((prev) => ({ ...prev, tunnelUrl }));
  }, []);

  const setIsTunnelStarting = useCallback((isTunnelStarting: boolean) => {
    setState((prev) => ({ ...prev, isTunnelStarting }));
  }, []);

  const setEmbeddedMode = useCallback(
    (isEmbedded: boolean, config: EmbeddedConfig = {}) => {
      setState((prev) => ({ ...prev, isEmbedded, embeddedConfig: config }));
    },
    []
  );

  const navigateToItem = useCallback(
    (serverId: string, tab: TabType, itemIdentifier?: string) => {
      console.warn("[InspectorContext] navigateToItem called:", {
        serverId,
        tab,
        itemIdentifier,
      });

      setState((prev) => ({
        ...prev,
        selectedServerId: serverId,
        activeTab: tab,
        selectedToolName: tab === "tools" ? itemIdentifier || null : null,
        selectedPromptName: tab === "prompts" ? itemIdentifier || null : null,
        selectedResourceUri:
          tab === "resources" ? itemIdentifier || null : null,
        selectedSamplingRequestId:
          tab === "sampling" ? itemIdentifier || null : null,
        selectedElicitationRequestId:
          tab === "elicitation" ? itemIdentifier || null : null,
      }));
    },
    []
  );

  const clearSelection = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectedToolName: null,
      selectedPromptName: null,
      selectedResourceUri: null,
      selectedSamplingRequestId: null,
      selectedElicitationRequestId: null,
    }));
  }, []);

  const value = {
    ...state,
    setSelectedServerId,
    setActiveTab,
    setSelectedToolName,
    setSelectedPromptName,
    setSelectedResourceUri,
    setSelectedSamplingRequestId,
    setSelectedElicitationRequestId,
    setTunnelUrl,
    setIsTunnelStarting,
    setEmbeddedMode,
    navigateToItem,
    clearSelection,
  };

  return <InspectorContext value={value}>{children}</InspectorContext>;
}

export function useInspector() {
  const context = use(InspectorContext);
  if (!context) {
    throw new Error("useInspector must be used within InspectorProvider");
  }
  return context;
}
