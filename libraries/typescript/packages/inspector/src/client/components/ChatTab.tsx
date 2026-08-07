import type {
  CallToolResult,
  ContentBlock,
  Prompt,
} from "@mcp-use/client/react";
import type { McpServer } from "@mcp-use/client/react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { History as HistoryIcon } from "lucide-react";
import { ChatHistoryPanel } from "@/client/chat-history/ChatHistoryPanel";
import { ChatHistoryRail } from "@/client/chat-history/ChatHistoryRail";
import { LocalChatStorageProvider } from "@/client/chat-history/providers/local-storage";
import type { ChatStorageProvider } from "@/client/chat-history/types";
import { useChatTitleGeneration } from "@/client/chat-history/useChatTitleGeneration";
import {
  CHAT_TITLE_PLACEHOLDER,
  CHAT_TITLE_SIMPLE,
  isPlaceholderTitle,
} from "@/client/chat-history/chat-title";
import { useInspector } from "@/client/context/InspectorContext";
import {
  MeshTabBackground,
  type ShaderPhase,
} from "@/client/components/ui/mesh-tab-background";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { copyToClipboard } from "@/client/utils/browser";
import { getServerDisplayName } from "@/client/utils/servers";
import { downloadJSON } from "../utils/jsonUtils";
import { isCloudFetchFailure } from "./chat/managedChatNotice";
import { formatManagedModelName } from "./chat/providerMeta";
import type { useManagedCloudModel } from "./chat/useManagedCloudModel";
import { useHostedSession } from "../hooks/useHostedSession";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useMCPPrompts } from "../hooks/useMCPPrompts";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatInputArea } from "./chat/ChatInputArea";
import { ChatLandingForm } from "./chat/ChatLandingForm";
import { ConfigurationDialog } from "./chat/ConfigurationDialog";
import { ConfigureEmptyState } from "./chat/ConfigureEmptyState";
import { MessageList } from "./chat/MessageList";
import { ChatScrollToBottomButton } from "./chat/ChatScrollToBottomButton";
import { ChatScrollTopFade } from "./chat/ChatScrollTopFade";
import { useChatScrollToBottom } from "./chat/useChatScrollToBottom";
import {
  FullscreenChatOverlay,
  useMcpWidgetFullscreen,
} from "./chat/FullscreenChatOverlay";
import type { ToolInfo } from "./chat/ToolSelector";
import { useChatMessages } from "./chat/useChatMessages";
import { useChatMessagesClientSide } from "./chat/useChatMessagesClientSide";
import { useConfig } from "./chat/useConfig";
import { useHostedChatMode } from "./chat/useHostedChatMode";
import { McpReconnectBanner } from "./chat/McpReconnectBanner";
import { ChatManagedNotice } from "./chat/ChatManagedNotice";
import { ChatRawView, type ChatView } from "./chat/ChatTraceView";
import { useLocalSystemPrompt } from "./chat/system-prompt/useLocalSystemPrompt";
import { resolveSystemPrompt } from "./chat/system-prompt/local-storage";
import type { ChatSystemPromptProvider } from "./chat/system-prompt/types";
import { useWidgetDebug } from "../context/WidgetDebugContext";
import type {
  ChatBodyBuilder,
  MessageAttachment,
  ToolAuthenticationRequest,
} from "./chat/types";
import { resolveChatToolPolicy } from "./chat/chat-tool-policy";

// Structural type — avoids nominal incompatibility when pnpm creates
// multiple peer-variant copies of mcp-use with duplicate class declarations.
type MCPConnection = {
  [K in keyof McpServer]: McpServer[K];
};
type ChatMessage = import("./chat/types").Message;

export interface ChatTabProps {
  connection: MCPConnection;
  isConnected: boolean;
  useClientSide?: boolean;
  /** Enable global keyboard shortcuts (Cmd+O for new chat). Default: true.
   *  Set to false when embedding to avoid conflicts with host app shortcuts. */
  enableKeyboardShortcuts?: boolean;
  prompts: Prompt[];
  serverId: string;
  readResource?: (uri: string) => Promise<any>;
  callPrompt: (name: string, args?: Record<string, unknown>) => Promise<any>;
  /** Custom API endpoint URL for server-side chat streaming (used when useClientSide=false).
   *  Defaults to "/inspector/api/chat/stream". */
  chatApiUrl?: string;
  /** When chatApiUrl is not yet available, called before sending to resolve the URL. Useful for background initialization. */
  waitForChatApiUrl?: () => Promise<string | undefined>;
  /** Pre-populate the chat with messages from a previous session (e.g. when restoring history). */
  initialMessages?: import("./chat/types").Message[];
  /** Externally-managed LLM config. When provided, bypasses localStorage-based config
   *  and hides the API key configuration UI. Useful for host apps that provide their own backend. */
  managedLlmConfig?: import("./chat/types").LLMConfig;
  /** Curated cloud model state when signed in on hosted inspector. */
  managedCloudModel?: ReturnType<typeof useManagedCloudModel>;
  /** Opt in to the Manufact free-tier sign-in / upgrade UI. Default: false. */
  enableFreeTierUpgrade?: boolean;
  /** Label for the clear/new-chat button. Default: "New Chat". */
  clearButtonLabel?: string;
  /** When true, hides the "Chat" title in the header. Default: false. */
  hideTitle?: boolean;
  /** When true, hides the model badge on the landing form. Default: false. */
  hideModelBadge?: boolean;
  /** When true, hides the MCP server URL on the landing form. Default: false. */
  hideServerUrl?: boolean;
  /** When true, hides the icon on the clear/new-chat button. */
  clearButtonHideIcon?: boolean;
  /** When true, hides the keyboard shortcut (⌘O) on the clear/new-chat button. */
  clearButtonHideShortcut?: boolean;
  /** Button variant for the clear/new-chat button. Default: "default". */
  clearButtonVariant?: "default" | "secondary" | "ghost" | "outline";
  /** When true, hides the "New Chat" / clear button entirely. */
  hideClearButton?: boolean;
  /** When true, hides the tool selector (wrench icon) in the chat input. */
  hideToolSelector?: boolean;
  /** Initial quick questions shown below the landing input. */
  chatQuickQuestions?: string[];
  /** Initial followups shown above input in active chat mode. */
  chatFollowups?: string[];
  /**
   * Wire protocol used by the streaming endpoint.
   * - `"sse"` (default): Inspector SSE protocol
   * - `"data-stream"`: Vercel AI SDK data-stream protocol
   */
  streamProtocol?: import("./chat/types").StreamProtocol;
  /** Credentials policy for the fetch request (e.g. `"include"` for cross-origin cookie auth). */
  credentials?: RequestCredentials;
  /** Extra headers to send with every streaming request. */
  extraHeaders?: Record<string, string>;
  /**
   * Custom body builder for the streaming request.
   * The second argument contains the effective disabled tools and serialized
   * scoped widget context. Existing one-argument callbacks remain valid.
   */
  body?: ChatBodyBuilder;
  /** Pluggable chat history storage. Defaults to localStorage in standalone mode. */
  chatStorageProvider?: ChatStorageProvider;
  /** When false, hides the built-in history sidebar even if a provider is available. */
  enableChatHistory?: boolean;
  /** Controlled active chat thread id */
  activeChatId?: string;
  onActiveChatIdChange?: (chatId: string | null) => void;
  /** When false, defer title generation until host signals persisted events (cloud embed). Default: true. */
  titleGenerationReady?: boolean;
  /** Known title for the active chat; skips generation when not the placeholder. */
  activeChatTitle?: string;
  /** Called after a title is generated and persisted via the storage provider. */
  onChatTitleGenerated?: (chatId: string, title: string) => void;
  /** Initial focused chat view. Default: "conv". */
  defaultView?: ChatView;
  /** Pluggable system prompt source. Defaults to localStorage per serverId. */
  systemPromptProvider?: ChatSystemPromptProvider;
  /** Raise ChatHeader above host chrome (cloud embed). */
  elevatedHeader?: boolean;
}

// Check text up to caret position for " /" or "/" at start of line or textarea
const PROMPT_TRIGGER_REGEX = /(?:^\/$|\s+\/$)/;
// Keys that trigger prompt dropdown actions if promptsDropdownOpen is true
const PROMPT_ARROW_KEYS = ["ArrowDown", "ArrowUp", "Escape", "Enter"];

export function ChatTab({
  connection,
  isConnected,
  useClientSide = true,
  enableKeyboardShortcuts = true,
  prompts,
  serverId,
  callPrompt,
  readResource,
  chatApiUrl,
  waitForChatApiUrl,
  initialMessages,
  managedLlmConfig,
  managedCloudModel,
  enableFreeTierUpgrade = false,
  clearButtonLabel,
  hideTitle,
  hideModelBadge,
  clearButtonHideIcon,
  clearButtonHideShortcut,
  clearButtonVariant,
  hideClearButton,
  hideToolSelector,
  chatQuickQuestions = [],
  chatFollowups = [],
  streamProtocol,
  credentials,
  extraHeaders,
  body,
  chatStorageProvider,
  enableChatHistory,
  activeChatId: controlledActiveChatId,
  onActiveChatIdChange,
  titleGenerationReady,
  activeChatTitle,
  onChatTitleGenerated,
  defaultView = "conv",
  systemPromptProvider: externalSystemPromptProvider,
  elevatedHeader,
}: ChatTabProps) {
  const isMcpWidgetFullscreen = useMcpWidgetFullscreen();
  const { isEmbedded } = useInspector();
  const localSystemPromptProvider = useLocalSystemPrompt(serverId);
  const effectiveSystemPromptProvider =
    externalSystemPromptProvider ?? localSystemPromptProvider;
  const resolvedSystemPrompt = useMemo(
    () => resolveSystemPrompt(effectiveSystemPromptProvider.prompt),
    [effectiveSystemPromptProvider.prompt]
  );
  const localChatStorageRef = useRef(new LocalChatStorageProvider());
  const effectiveChatStorage =
    chatStorageProvider ??
    (!isEmbedded && enableChatHistory !== false
      ? localChatStorageRef.current
      : null);

  const [internalActiveChatId, setInternalActiveChatId] = useState<
    string | null
  >(null);
  const activeChatId = controlledActiveChatId ?? internalActiveChatId;
  const setActiveChatId = useCallback(
    (chatId: string | null) => {
      if (onActiveChatIdChange) {
        onActiveChatIdChange(chatId);
      } else {
        setInternalActiveChatId(chatId);
      }
    },
    [onActiveChatIdChange]
  );

  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [historyRefetchKey, setHistoryRefetchKey] = useState(0);
  const [internalChatTitle, setInternalChatTitle] = useState<
    string | undefined
  >();
  const [restoredMessages, setRestoredMessages] = useState<
    import("./chat/types").Message[] | undefined
  >(undefined);
  const [inputValue, setInputValue] = useState("");
  const [promptsDropdownOpen, setPromptsDropdownOpen] = useState(false);
  const [promptFocusedIndex, setPromptFocusedIndex] = useState(-1);
  const [quickQuestions, setQuickQuestions] =
    useState<string[]>(chatQuickQuestions);
  const [followups, setFollowups] = useState<string[]>(chatFollowups);
  const [activeView, setActiveView] = useState<ChatView>(defaultView);
  const [disabledTools, setDisabledTools] = useState<Set<string>>(new Set());
  const [disabledSkillUris, setDisabledSkillUris] = useState<Set<string>>(
    new Set()
  );
  const skills = connection.skills ?? [];
  const enabledSkillUris = useMemo(
    () =>
      new Set(
        skills
          .map((skill) => skill.uri)
          .filter((uri) => !disabledSkillUris.has(uri))
      ),
    [skills, disabledSkillUris]
  );
  const setEnabledSkillUris = useCallback(
    (enabled: Set<string>) => {
      setDisabledSkillUris(
        new Set(
          skills.map((skill) => skill.uri).filter((uri) => !enabled.has(uri))
        )
      );
    },
    [skills]
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesAreaRef = useRef<HTMLDivElement | null>(null);
  // Track position of trigger for removal in textarea
  const triggerSpanRef = useRef<{ start: number; end: number } | null>(null);

  const { modelVisibleTools, effectiveDisabledTools } = useMemo(
    () => resolveChatToolPolicy(connection.tools ?? [], disabledTools),
    [connection.tools, disabledTools]
  );

  const toolInfos: ToolInfo[] = useMemo(
    () =>
      modelVisibleTools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
    [modelVisibleTools]
  );

  // Use custom hooks for configuration, chat messages and mcp prompts handling
  const {
    llmConfig: localLlmConfig,
    authConfig: userAuthConfig,
    configDialogOpen,
    setConfigDialogOpen,
    tempProvider,
    setTempProvider,
    tempApiKey,
    setTempApiKey,
    tempModel,
    setTempModel,
    tempBaseUrl,
    setTempBaseUrl,
    saveLLMConfig,
    clearConfig,
  } = useConfig({ mcpServerUrl: connection.url ?? "" });

  const { setForceClientSide, effectiveClientSide, llmConfig, isManaged } =
    useHostedChatMode({
      useClientSide,
      managedLlmConfig,
      localLlmConfig,
    });

  const { getModelContexts, getAppToolConnections } = useWidgetDebug();
  const modelContextScope = `chat:${serverId}`;
  const widgetModelContexts = getModelContexts(modelContextScope);
  const appToolConnections = getAppToolConnections(modelContextScope);

  // Use client-side or server-side chat implementation
  const chatHookParams = {
    connection,
    llmConfig,
    isConnected,
    readResource,
    widgetModelContexts,
    disabledTools: effectiveDisabledTools,
    enabledSkillUris,
    appToolConnections,
  };

  const serverSideChat = useChatMessages({
    mcpServerUrl: connection.url ?? "",
    llmConfig,
    authConfig: userAuthConfig,
    mcpAuthTokens: connection.authTokens,
    isConnected,
    chatApiUrl,
    waitForChatApiUrl,
    widgetModelContexts,
    initialMessages: restoredMessages ?? initialMessages,
    disabledTools: effectiveDisabledTools,
    enabledSkillUris,
    streamProtocol,
    credentials,
    extraHeaders,
    body,
  });
  const clientSideChat = useChatMessagesClientSide({
    ...chatHookParams,
    initialMessages: restoredMessages ?? initialMessages,
    systemPrompt: resolvedSystemPrompt,
    skills,
  });

  const {
    messages,
    isLoading,
    attachments,
    sendMessage,
    clearMessages,
    setMessages,
    stop,
    addAttachment,
    removeAttachment,
    clearTrace,
    traceEvents,
    tokenUsage,
  } = effectiveClientSide ? clientSideChat : serverSideChat;

  const sendWidgetMessage = useCallback(
    (message: string, widgetAttachments?: MessageAttachment[]) =>
      new Promise<void>((resolve, reject) => {
        void sendMessage(message, [], widgetAttachments, {
          throwOnError: true,
          onAccepted: resolve,
        }).then(resolve, reject);
      }),
    [sendMessage]
  );

  const [shaderPhase, setShaderPhase] = useState<ShaderPhase>(() =>
    messages.length === 0 ? "visible" : "hidden"
  );

  const dismissLandingShader = useCallback(() => {
    setShaderPhase((p) => (p === "visible" ? "fading" : p));
  }, []);

  const clearChatToLanding = useCallback(() => {
    clearMessages();
    setDisabledSkillUris(new Set());
    setShaderPhase("visible");
  }, [clearMessages]);

  const { messagesEndRef, showScrollToBottom, showTopFade, scrollToBottom } =
    useChatScrollToBottom(messagesAreaRef, {
      messageCount: messages.length,
      isLoading,
      enabled: !!llmConfig,
    });

  const handleSelectChat = useCallback(
    async (chatId: string) => {
      if (!effectiveChatStorage) return;
      const [msgs, listed] = await Promise.all([
        effectiveChatStorage.getMessages(chatId),
        effectiveChatStorage.listChats({ agentId: serverId }),
      ]);
      setRestoredMessages(msgs);
      clearTrace();
      setMessages(msgs);
      setShaderPhase(msgs.length === 0 ? "visible" : "hidden");
      setActiveChatId(chatId);
      setInternalChatTitle(
        listed.items.find((session) => session.id === chatId)?.title
      );
    },
    [effectiveChatStorage, clearTrace, setMessages, setActiveChatId, serverId]
  );

  const handleNewChat = useCallback(async () => {
    clearMessages();
    setRestoredMessages([]);
    setShaderPhase("visible");
    setInternalChatTitle(CHAT_TITLE_PLACEHOLDER);
    setActiveChatId(null);
    setDisabledSkillUris(new Set());
    if (effectiveChatStorage) {
      const session = await effectiveChatStorage.createChat({
        agentId: serverId,
        agentName: connection.displayName || connection.name || "MCP Server",
      });
      setActiveChatId(session.id);
      setHistoryRefetchKey((k) => k + 1);
    } else {
      setInternalChatTitle(undefined);
    }
  }, [
    clearMessages,
    effectiveChatStorage,
    serverId,
    connection.displayName,
    connection.name,
    setActiveChatId,
  ]);

  const ensureActiveChat = useCallback(async () => {
    if (!effectiveChatStorage || activeChatId) return activeChatId;
    const session = await effectiveChatStorage.createChat({
      agentId: serverId,
      agentName: connection.displayName || connection.name || "MCP Server",
    });
    setActiveChatId(session.id);
    setInternalChatTitle(CHAT_TITLE_PLACEHOLDER);
    setHistoryRefetchKey((k) => k + 1);
    return session.id;
  }, [
    effectiveChatStorage,
    activeChatId,
    serverId,
    connection.displayName,
    connection.name,
    setActiveChatId,
  ]);

  useEffect(() => {
    if (!effectiveChatStorage?.saveMessages || !activeChatId) return;
    void effectiveChatStorage.saveMessages(activeChatId, messages);
  }, [effectiveChatStorage, activeChatId, messages]);

  const bumpHistoryRefetch = useCallback(() => {
    setHistoryRefetchKey((k) => k + 1);
  }, []);

  const handleTitleGenerated = useCallback(
    (chatId: string, title: string) => {
      setInternalChatTitle(title);
      onChatTitleGenerated?.(chatId, title);
    },
    [onChatTitleGenerated]
  );

  const effectiveActiveChatTitle = activeChatTitle ?? internalChatTitle;
  const headerDisplayTitle =
    effectiveActiveChatTitle && !isPlaceholderTitle(effectiveActiveChatTitle)
      ? effectiveActiveChatTitle
      : CHAT_TITLE_SIMPLE;

  useChatTitleGeneration({
    activeChatId,
    storage: effectiveChatStorage,
    messages,
    isLoading,
    effectiveClientSide,
    llmConfig,
    activeChatTitle: effectiveActiveChatTitle,
    titleGenerationReady,
    onTitleGenerated: handleTitleGenerated,
    onHistoryRefetch: bumpHistoryRefetch,
  });

  const managedChatNotice =
    clientSideChat.managedChatNotice ??
    serverSideChat.managedChatNotice ??
    null;

  const clearManagedChatNotice = useCallback(() => {
    clientSideChat.clearManagedChatNotice();
    serverSideChat.clearManagedChatNotice();
  }, [
    clientSideChat.clearManagedChatNotice,
    serverSideChat.clearManagedChatNotice,
  ]);

  const showManagedChatNotice = useCallback(
    (notice: NonNullable<typeof managedChatNotice>) => {
      clientSideChat.showManagedChatNotice(notice);
      serverSideChat.showManagedChatNotice(notice);
    },
    [clientSideChat.showManagedChatNotice, serverSideChat.showManagedChatNotice]
  );

  const handleSaveLLMConfig = useCallback(() => {
    if (!saveLLMConfig()) return;
    setForceClientSide(true);
    clearManagedChatNotice();
  }, [saveLLMConfig, setForceClientSide, clearManagedChatNotice]);

  const mcpServerAuthRequired = effectiveClientSide
    ? null
    : (serverSideChat.mcpServerAuthRequired ?? null);

  const clearMcpServerAuthRequired = effectiveClientSide
    ? undefined
    : serverSideChat.clearMcpServerAuthRequired;

  const [authenticatingTool, setAuthenticatingTool] = useState(false);
  const [retryingTool, setRetryingTool] = useState(false);

  const handleToolAuthentication = useCallback(
    async (_request: ToolAuthenticationRequest) => {
      setAuthenticatingTool(true);
      try {
        await connection.authenticate();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? `Authentication failed: ${error.message}`
            : "Authentication failed"
        );
      } finally {
        setAuthenticatingTool(false);
      }
    },
    [connection]
  );

  const handleRetryAuthenticatedTool = useCallback(
    async (request: ToolAuthenticationRequest) => {
      setRetryingTool(true);
      const updateInvocation = (
        result: unknown,
        state: "pending" | "result" | "error",
        truncateAfterTool = false
      ) => {
        setMessages((current) =>
          current.map((message) => {
            if (message.id !== request.messageId || !message.parts) {
              return message;
            }

            const partIndex = message.parts.findIndex(
              (part) =>
                part.type === "tool-invocation" &&
                (request.toolCallId
                  ? part.toolInvocation?.toolCallId === request.toolCallId
                  : part.toolInvocation?.toolName === request.toolName)
            );
            if (partIndex < 0) return message;

            const parts = message.parts.map((part, index) =>
              index === partIndex && part.toolInvocation
                ? {
                    ...part,
                    toolInvocation: {
                      ...part.toolInvocation,
                      result,
                      state,
                    },
                  }
                : part
            );

            return {
              ...message,
              parts: truncateAfterTool ? parts.slice(0, partIndex + 1) : parts,
            };
          })
        );
      };

      updateInvocation(undefined, "pending", true);
      try {
        const result = await connection.callTool(
          request.toolName,
          request.args
        );
        updateInvocation(
          result,
          result && typeof result === "object" && "isError" in result
            ? (result as { isError?: boolean }).isError
              ? "error"
              : "result"
            : "result"
        );
      } catch (error) {
        updateInvocation(
          {
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
              },
            ],
            isError: true,
          },
          "error"
        );
      } finally {
        setRetryingTool(false);
      }
    },
    [connection, setMessages]
  );

  const handleMcpReconnect = useCallback(async () => {
    try {
      await connection.authenticate();
    } catch (err) {
      console.error("[ChatTab] MCP reconnect failed:", err);
      toast.error(
        err instanceof Error
          ? `Reconnect failed: ${err.message}`
          : "Reconnect failed"
      );
      return;
    }
    clearMcpServerAuthRequired?.();
  }, [connection, clearMcpServerAuthRequired]);

  const reconnectBannerNode = mcpServerAuthRequired ? (
    <McpReconnectBanner
      serverName={connection.name}
      serverUrl={mcpServerAuthRequired.mcpServerUrl}
      message={mcpServerAuthRequired.message}
      onReconnect={handleMcpReconnect}
      onDismiss={clearMcpServerAuthRequired}
    />
  ) : null;

  const handleConfigureFromNotice = useCallback(() => {
    setConfigDialogOpen(true);
  }, [setConfigDialogOpen]);

  const {
    user: hostedUser,
    authorizing,
    authorize,
  } = useHostedSession(enableFreeTierUpgrade ? chatApiUrl : undefined);
  const handleOpenLogin = useCallback(() => {
    setConfigDialogOpen(false);
    void authorize().catch((error) => {
      if (chatApiUrl && isCloudFetchFailure(error)) {
        showManagedChatNotice({ kind: "cloud_unavailable" });
        return;
      }
      toast.error(
        error instanceof Error ? error.message : "Authorization failed"
      );
    });
  }, [authorize, chatApiUrl, setConfigDialogOpen, showManagedChatNotice]);

  // Whether the visitor is signed in to Manufact (hosted free-tier only). Used
  // to suppress the "Sign in to increase your limits" prompt once authenticated
  // — otherwise signed-in users keep getting asked to log in (MCP-2142).
  const isHostedAuthenticated = hostedUser != null;

  useEffect(() => {
    if (managedChatNotice?.kind !== "login_required") return;

    if (isHostedAuthenticated) {
      clearManagedChatNotice();
      return;
    }

    if (enableFreeTierUpgrade) {
      clearManagedChatNotice();
      setConfigDialogOpen(true);
    }
  }, [
    clearManagedChatNotice,
    enableFreeTierUpgrade,
    isHostedAuthenticated,
    managedChatNotice?.kind,
    setConfigDialogOpen,
  ]);

  const freeTierInfo =
    enableFreeTierUpgrade && !isHostedAuthenticated
      ? { onLoginClick: handleOpenLogin }
      : undefined;

  // Host embed (e.g. cloud dashboard) passes `managedLlmConfig` + `hideModelBadge`
  // because it renders its own model row (`ServerChatHeader`). Suppress inspector
  // model chrome on both landing and threaded views even when localStorage BYOK
  // sets `effectiveClientSide` — otherwise ChatHeader's absolute model badge
  // overlaps the dashboard controls (MCP-1913).
  const suppressInspectorModelChrome =
    Boolean(managedLlmConfig) && Boolean(hideModelBadge);

  const hideInputModelBadge = suppressInspectorModelChrome;

  const managedCloudInfo =
    enableFreeTierUpgrade && isHostedAuthenticated && managedCloudModel
      ? {
          models: managedCloudModel.models,
          selectedModelId: managedCloudModel.selectedModelId,
          onModelChange: managedCloudModel.setSelectedModelId,
          isLoading: managedCloudModel.isLoading,
        }
      : undefined;

  const modelBadgeMode = isManaged ? ("managed" as const) : ("byok" as const);
  const modelDisplayName =
    isManaged && managedCloudModel?.selectedModel
      ? formatManagedModelName(
          managedCloudModel.selectedModel.name,
          managedCloudModel.selectedModel.provider
        )
      : undefined;

  const handleSaveManagedCloud = useCallback(() => {
    setForceClientSide(false);
    clearManagedChatNotice();
    setConfigDialogOpen(false);
  }, [clearManagedChatNotice, setConfigDialogOpen, setForceClientSide]);

  const {
    filteredPrompts,
    setSelectedPrompt,
    selectedPrompt,
    setPromptArgs,
    executePrompt,
    results,
    handleDeleteResult,
    clearPromptResults,
  } = useMCPPrompts({
    prompts,
    callPrompt,
    serverId,
  });

  const sanitizeStringList = useCallback((input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    return input
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  }, []);

  const serializeMessageContent = useCallback((message: ChatMessage) => {
    if (typeof message.content === "string" && message.content.trim()) {
      return message.content;
    }

    if (Array.isArray(message.content) && message.content.length > 0) {
      return message.content
        .map((item) => (typeof item === "string" ? item : (item.text ?? "")))
        .join("");
    }

    if (message.parts && message.parts.length > 0) {
      const textParts = message.parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text);

      if (textParts.length > 0) {
        return textParts.join("\n");
      }
    }

    return "";
  }, []);

  const serializeToolResult = useCallback((result: unknown) => {
    if (result === null || result === undefined) return "No result";

    if (typeof result === "string") {
      try {
        const parsed = JSON.parse(result);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return result;
      }
    }

    if (
      typeof result === "object" &&
      Array.isArray((result as CallToolResult).content)
    ) {
      const content = (result as CallToolResult).content;
      if (content.length === 0) return "Empty result";

      return content
        .map((item: ContentBlock) => {
          if (item.type === "text") {
            const text = item.text || "";
            try {
              return JSON.stringify(JSON.parse(text), null, 2);
            } catch {
              return text;
            }
          }
          if (item.type === "image") {
            return `[Image: ${item.mimeType}]`;
          }
          if (item.type === "resource") {
            return `[Resource: ${item.resource?.uri || "unknown"}]`;
          }
          return JSON.stringify(item, null, 2);
        })
        .join("\n\n");
    }

    return JSON.stringify(result, null, 2);
  }, []);

  const getSerializedMessages = useCallback(() => {
    return messages.map((message) => {
      const textContent = serializeMessageContent(message);
      const toolInvocations = message.parts
        ?.filter((p) => p.type === "tool-invocation" && p.toolInvocation)
        .map((p) => ({
          toolName: p.toolInvocation!.toolName,
          args: p.toolInvocation!.args,
          state: p.toolInvocation!.state,
          result:
            typeof p.toolInvocation!.result === "string"
              ? p.toolInvocation!.result.slice(0, 2000)
              : p.toolInvocation!.result != null
                ? JSON.stringify(p.toolInvocation!.result).slice(0, 2000)
                : undefined,
        }));
      const content =
        textContent ||
        (toolInvocations?.length
          ? `[Tool calls: ${toolInvocations.map((t) => `${t.toolName}(${t.state})`).join(", ")}]`
          : "");
      return {
        id: message.id,
        role: message.role,
        content,
        timestamp: message.timestamp,
        toolInvocations: toolInvocations?.length ? toolInvocations : undefined,
      };
    });
  }, [messages, serializeMessageContent]);

  const postBridgeEvent = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (typeof window === "undefined" || window.parent === window) return;
      window.parent.postMessage(
        {
          type,
          serverId,
          ...payload,
        },
        "*"
      );
    },
    [serverId]
  );

  useEffect(() => {
    postBridgeEvent("mcp-inspector:chat:ready", {
      capabilities: {
        send: true,
        clear: true,
        getState: true,
        setQuickQuestions: true,
        setFollowups: true,
        loadMessages: true,
      },
    });
  }, [postBridgeEvent]);

  useEffect(() => {
    postBridgeEvent("mcp-inspector:chat:state_changed", {
      isLoading,
      messageCount: messages.length,
      messages: getSerializedMessages(),
      quickQuestions,
      followups,
    });
  }, [
    followups,
    getSerializedMessages,
    isLoading,
    messages.length,
    postBridgeEvent,
    quickQuestions,
  ]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== "object") return;

      const data = event.data as {
        type?: string;
        requestId?: string;
        serverId?: string;
        message?: string;
        prompt?: string;
        questions?: unknown;
        followups?: unknown;
      };

      if (!data.type?.startsWith("mcp-inspector:chat:")) return;
      if (data.serverId && data.serverId !== serverId) return;

      const requestId = data.requestId;
      const postResult = (ok: boolean, extra: Record<string, unknown> = {}) => {
        postBridgeEvent("mcp-inspector:chat:command_result", {
          requestId,
          ok,
          ...extra,
        });
      };

      if (data.type === "mcp-inspector:chat:send") {
        const text = (data.message ?? data.prompt ?? "").trim();
        if (!text) {
          postResult(false, { error: "Missing message" });
          return;
        }
        if (!llmConfig || !isConnected) {
          postResult(false, { error: "Chat is not ready to send messages" });
          return;
        }
        if (messages.length === 0) {
          dismissLandingShader();
        }
        void sendMessage(text, [])
          .then(() => {
            postBridgeEvent("mcp-inspector:chat:message_sent", {
              requestId,
              message: text,
              source: "bridge",
            });
            postResult(true);
          })
          .catch((error: unknown) => {
            postResult(false, {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return;
      }

      if (data.type === "mcp-inspector:chat:clear") {
        clearChatToLanding();
        postBridgeEvent("mcp-inspector:chat:cleared", { requestId });
        postResult(true);
        return;
      }

      if (data.type === "mcp-inspector:chat:get_state") {
        postBridgeEvent("mcp-inspector:chat:state", {
          requestId,
          isLoading,
          messageCount: messages.length,
          messages: getSerializedMessages(),
          quickQuestions,
          followups,
        });
        postResult(true);
        return;
      }

      if (data.type === "mcp-inspector:chat:set_quick_questions") {
        const values = sanitizeStringList(data.questions);
        setQuickQuestions(values);
        postResult(true, { quickQuestions: values });
        return;
      }

      if (data.type === "mcp-inspector:chat:set_followups") {
        const values = sanitizeStringList(data.followups);
        setFollowups(values);
        postResult(true, { followups: values });
        return;
      }

      if (data.type === "mcp-inspector:chat:load_messages") {
        const rawMessages = (data as unknown as { messages?: unknown })
          .messages;
        if (!Array.isArray(rawMessages)) {
          postResult(false, { error: "messages must be an array" });
          return;
        }
        setMessages(rawMessages as ChatMessage[]);
        postResult(true, { count: rawMessages.length });
        return;
      }

      if (data.type === "mcp-inspector:chat:screenshot") {
        const targetToolCallId = (data as any).toolCallId as
          | string
          | null
          | undefined;

        (async () => {
          try {
            let target: HTMLElement | null = null;

            if (targetToolCallId) {
              target = document.querySelector(
                `[data-tool-call-id="${targetToolCallId}"]`
              );
            }

            if (!target) {
              const widgets = document.querySelectorAll("[data-tool-call-id]");
              if (widgets.length > 0) {
                target = widgets[widgets.length - 1] as HTMLElement;
              }
            }

            if (!target && messagesAreaRef.current) {
              target = messagesAreaRef.current;
            }

            if (!target) {
              postResult(false, { error: "No screenshot target found" });
              return;
            }

            const timeoutMs = 10000;
            let image: string | null = null;
            let htmlToImageError = "";
            let html2canvasError = "";

            // Try html-to-image first — uses browser-native SVG rendering,
            // handles modern CSS (oklch, color-mix, etc.) that html2canvas cannot parse.
            try {
              const cdnUrl = "https://esm.sh/html-to-image@1.11.13";
              const htmlToImage: any = await import(/* @vite-ignore */ cdnUrl);
              if (htmlToImage?.toPng) {
                image = await Promise.race([
                  htmlToImage.toPng(target, {
                    pixelRatio: 1,
                    backgroundColor: "#ffffff",
                    includeQueryParams: true,
                  }),
                  new Promise<never>((_, reject) =>
                    setTimeout(
                      () => reject(new Error("html-to-image timed out")),
                      timeoutMs
                    )
                  ),
                ]);
              } else {
                htmlToImageError = "toPng not found on module";
              }
            } catch (e) {
              htmlToImageError = e instanceof Error ? e.message : String(e);
            }

            if (!image) {
              try {
                if (!(window as any).html2canvas) {
                  const script = document.createElement("script");
                  script.src =
                    "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
                  document.head.appendChild(script);
                  await new Promise<void>((resolve, reject) => {
                    script.onload = () => resolve();
                    script.onerror = () =>
                      reject(new Error("Failed to load html2canvas"));
                  });
                }
                const html2canvas = (window as any).html2canvas;
                const canvas = await Promise.race([
                  html2canvas(target, {
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: "#ffffff",
                    scale: 1,
                    logging: false,
                    foreignObjectRendering: false,
                  }),
                  new Promise<never>((_, reject) =>
                    setTimeout(
                      () => reject(new Error("html2canvas timed out")),
                      timeoutMs
                    )
                  ),
                ]);
                image = canvas.toDataURL("image/png");
              } catch (e) {
                html2canvasError = e instanceof Error ? e.message : String(e);
              }
            }

            if (image) {
              postBridgeEvent("mcp-inspector:chat:screenshot_result", {
                requestId,
                toolCallId: targetToolCallId || null,
                image,
                timestamp: Date.now(),
              });
              postResult(true);
            } else {
              const fallbackTarget = messagesAreaRef.current || document.body;
              const domText =
                fallbackTarget.innerText?.substring(0, 5000) || "";
              const domHtml =
                fallbackTarget.innerHTML?.substring(0, 10000) || "";
              postBridgeEvent("mcp-inspector:chat:screenshot_result", {
                requestId,
                toolCallId: targetToolCallId || null,
                image: "",
                domText,
                domHtml,
                error: `html-to-image: ${htmlToImageError || "ok"}; html2canvas: ${html2canvasError || "ok"}`,
                timestamp: Date.now(),
              });
              postResult(false, {
                error: `html-to-image: ${htmlToImageError}; html2canvas: ${html2canvasError}`,
              });
            }
          } catch (error) {
            const fallbackTarget = messagesAreaRef.current || document.body;
            const domText = fallbackTarget.innerText?.substring(0, 5000) || "";
            postBridgeEvent("mcp-inspector:chat:screenshot_result", {
              requestId,
              toolCallId: targetToolCallId || null,
              image: "",
              domText,
              error:
                error instanceof Error
                  ? error.message
                  : "Screenshot capture failed",
              timestamp: Date.now(),
            });
            postResult(false, {
              error:
                error instanceof Error ? error.message : "Screenshot failed",
            });
          }
        })();
        return;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    clearChatToLanding,
    dismissLandingShader,
    setMessages,
    followups,
    getSerializedMessages,
    isLoading,
    messages.length,
    postBridgeEvent,
    quickQuestions,
    sanitizeStringList,
    sendMessage,
    serverId,
    llmConfig,
    isConnected,
  ]);

  // Register keyboard shortcuts (only active when ChatTab is mounted and enabled)
  useKeyboardShortcuts(
    enableKeyboardShortcuts
      ? {
          onNewChat: effectiveChatStorage ? handleNewChat : clearChatToLanding,
        }
      : {}
  );

  const wrapWithHistory = (content: React.ReactNode) => {
    const framed = (
      <MeshTabBackground
        className="h-full w-full"
        shaderPhase={shaderPhase}
        meshAnimationPaused={configDialogOpen}
        onShaderFadeComplete={() => setShaderPhase("hidden")}
      >
        {content}
      </MeshTabBackground>
    );

    if (!effectiveChatStorage) return framed;

    return (
      <div className="flex h-full flex-row overflow-hidden">
        <div
          className="group/chat-history relative hidden shrink-0 flex-col overflow-visible transition-[width] duration-200 lg:flex"
          style={{ width: showHistoryPanel ? 320 : 0 }}
        >
          {showHistoryPanel && (
            <div className="flex h-full w-full flex-col overflow-hidden border-r border-zinc-200 bg-background dark:border-zinc-700">
              <ChatHistoryPanel
                provider={effectiveChatStorage}
                open={true}
                onOpenChange={setShowHistoryPanel}
                currentChatId={activeChatId ?? undefined}
                agentId={serverId}
                agentDisplayNameFallback={
                  connection.displayName || connection.name || "MCP Server"
                }
                onSelectChat={handleSelectChat}
                variant="inline"
                containerClassName="h-full border-0"
                refetchKey={historyRefetchKey}
                onCurrentChatDeleted={() => void handleNewChat()}
              />
            </div>
          )}
          {showHistoryPanel && (
            <ChatHistoryRail onCollapse={() => setShowHistoryPanel(false)} />
          )}
        </div>

        <div className="relative min-w-0 flex-1 overflow-hidden">
          {!showHistoryPanel && (
            <div
              data-chat-history-toggle
              className="absolute top-1/2 left-4 z-50 hidden -translate-y-1/2 lg:block [[data-mcp-widget-fullscreen]_&]:pointer-events-none [[data-mcp-widget-fullscreen]_&]:invisible"
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-10 aspect-square rounded-full"
                      onClick={() => setShowHistoryPanel(true)}
                    >
                      <HistoryIcon size={16} />
                    </Button>
                  }
                  nativeButton
                />
                <TooltipContent side="right">
                  <p>Chat History</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
          {framed}
        </div>
      </div>
    );
  };

  const clearPromptsUIState = useCallback(() => {
    setPromptFocusedIndex(-1);
    setPromptsDropdownOpen(false);
    triggerSpanRef.current = null;
  }, []);

  const updatePromptsDropdownState = useCallback(() => {
    if (!textareaRef.current) {
      return;
    }
    const caretIndex = textareaRef.current.selectionStart;
    const textUpToCaret = inputValue.slice(0, caretIndex);
    const isPromptsRequested = PROMPT_TRIGGER_REGEX.test(textUpToCaret);
    setPromptsDropdownOpen(isPromptsRequested);
    if (isPromptsRequested) {
      triggerSpanRef.current = { start: caretIndex - 1, end: caretIndex };
      setPromptFocusedIndex(0);
    } else {
      clearPromptsUIState();
    }
  }, [inputValue, clearPromptsUIState]);

  // Focus the textarea when landing form is shown
  useEffect(() => {
    if (llmConfig && messages.length === 0 && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [llmConfig, messages.length]);

  // Auto-refocus the textarea after streaming completes
  useEffect(() => {
    if (!isLoading && messages.length > 0 && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isLoading, messages.length]);

  // Handle MCP prompts requested
  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    updatePromptsDropdownState();
  }, [inputValue, updatePromptsDropdownState]);

  const clearPromptsState = useCallback(() => {
    setSelectedPrompt(null);
    setPromptArgs({});
    clearPromptsUIState();
  }, [clearPromptsUIState]);

  const handlePromptSelect = useCallback(
    async (prompt: Prompt) => {
      setSelectedPrompt(prompt);

      if (prompt.arguments && prompt.arguments.length > 0) {
        // Reject prompt if has args for now
        setSelectedPrompt(null);
        toast.error("Prompts with arguments are not supported", {
          description:
            "This prompt requires arguments which are not yet supported in chat mode.",
        });
        // Add support for prompts with args here
        return;
      }

      try {
        const EMPTY_ARGS: Record<string, unknown> = {};
        await executePrompt(prompt, EMPTY_ARGS);
      } catch (error) {
        console.error("Error executing prompt", error);
      } finally {
        if (textareaRef.current && triggerSpanRef.current) {
          const { start, end } = triggerSpanRef.current;
          const next = inputValue.slice(0, start) + inputValue.slice(end);
          setInputValue(next);
          requestAnimationFrame(() => {
            // focus and set trigger span position
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(start, start);
          });
        }
        clearPromptsState();
      }
    },
    [executePrompt, clearPromptsState, inputValue]
  );

  const handleSkillSelect = useCallback(
    (skill: (typeof skills)[number]) => {
      const next = new Set(enabledSkillUris);
      if (next.has(skill.uri)) next.delete(skill.uri);
      else next.add(skill.uri);
      setEnabledSkillUris(next);

      if (textareaRef.current && triggerSpanRef.current) {
        const { start, end } = triggerSpanRef.current;
        const nextInput = inputValue.slice(0, start) + inputValue.slice(end);
        setInputValue(nextInput);
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
          textareaRef.current?.setSelectionRange(start, start);
        });
      }
      clearPromptsState();
    },
    [clearPromptsState, enabledSkillUris, inputValue, setEnabledSkillUris]
  );

  const handleSendMessage = useCallback(() => {
    // Can send if there's text, prompt results, or attachments
    const hasContent =
      inputValue.trim() || results.length > 0 || attachments.length > 0;
    if (!hasContent) {
      return;
    }
    if (messages.length === 0) {
      dismissLandingShader();
    }
    void ensureActiveChat().then(() => {
      sendMessage(inputValue, results);
      setInputValue("");
      clearPromptResults();
    });
  }, [
    inputValue,
    results,
    sendMessage,
    clearPromptResults,
    attachments,
    ensureActiveChat,
    messages.length,
    dismissLandingShader,
  ]);

  const handlePromptKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "ArrowDown") {
        setPromptFocusedIndex((prev) => {
          const suggestionCount = filteredPrompts.length + skills.length;
          if (suggestionCount === 0) return -1;
          return (prev + 1) % suggestionCount;
        });
      } else if (e.key === "ArrowUp") {
        setPromptFocusedIndex((prev) => {
          const suggestionCount = filteredPrompts.length + skills.length;
          if (suggestionCount === 0) return -1;
          return (prev - 1 + suggestionCount) % suggestionCount;
        });
      } else if (e.key === "Escape") {
        e.stopPropagation();
        clearPromptsUIState();
      } else if (e.key === "Enter" && promptFocusedIndex >= 0) {
        const prompt = filteredPrompts[promptFocusedIndex];
        if (prompt) {
          handlePromptSelect(prompt);
        } else {
          const skill = skills[promptFocusedIndex - filteredPrompts.length];
          if (skill) handleSkillSelect(skill);
        }
      }
    },
    [
      filteredPrompts,
      skills,
      promptFocusedIndex,
      handlePromptSelect,
      handleSkillSelect,
      clearPromptsUIState,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (PROMPT_ARROW_KEYS.includes(e.key) && promptsDropdownOpen) {
        e.preventDefault();
        handlePromptKeyDown(e);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage, handlePromptKeyDown, promptsDropdownOpen]
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        updatePromptsDropdownState();
      }
    },
    [updatePromptsDropdownState]
  );

  const formatMessagesAsMarkdown = useCallback(
    (messages: ChatMessage[]) => {
      let content = `# Chat Export - ${new Date().toLocaleString()}\n\n`;
      content += messages
        .map((m) => {
          const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);

          if (!m.parts || m.parts.length === 0) {
            const messageContent = serializeMessageContent(m).trim();
            return messageContent ? `## ${role}\n${messageContent}` : "";
          }

          const sections: string[] = [];
          for (const part of m.parts) {
            if (part.type === "text" && part.text?.trim()) {
              sections.push(part.text.trim());
            } else if (part.type === "tool-invocation" && part.toolInvocation) {
              const ti = part.toolInvocation;
              const resultStr = serializeToolResult(ti.result);
              sections.push(
                `#### ${ti.toolName}\n**Arguments:**\n\`\`\`json\n${JSON.stringify(ti.args, null, 2)}\n\`\`\`\n**Result:**\n\n${resultStr}`
              );
            }
          }

          if (sections.length === 0) return "";
          return `## ${role}\n\n${sections.join("\n\n")}`;
        })
        .filter((text) => text !== "")
        .join("\n\n---\n\n");
      return content;
    },
    [serializeMessageContent, serializeToolResult]
  );

  const handleCopyChat = useCallback(() => {
    const formattedMessages = formatMessagesAsMarkdown(messages);

    copyToClipboard(formattedMessages).then(
      () => toast.success("Chat copied to clipboard"),
      () => toast.error("Failed to copy chat")
    );
  }, [messages, formatMessagesAsMarkdown]);

  const handleExportChat = useCallback(
    (format: "json" | "markdown") => {
      const dateStr = new Date().toISOString().split("T")[0];
      const filename = `chat-export-${dateStr}`;

      if (format === "json") {
        const exportedMessages = messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: serializeMessageContent(m),
          timestamp: m.timestamp,
          toolInvocations: m.parts
            ?.filter((p) => p.type === "tool-invocation" && p.toolInvocation)
            .map((p) => ({
              toolName: p.toolInvocation!.toolName,
              args: p.toolInvocation!.args,
              result: p.toolInvocation!.result,
            })),
        }));
        downloadJSON(exportedMessages, filename + ".json");
      } else {
        const content = formatMessagesAsMarkdown(messages);
        const blob = new Blob([content], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename + ".md";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 100);
      }
      toast.success(`Chat exported as ${format.toUpperCase()}`);
    },
    [messages, formatMessagesAsMarkdown, serializeMessageContent]
  );

  const handleClearConfig = useCallback(() => {
    clearConfig();
    void handleNewChat();
  }, [clearConfig, handleNewChat]);

  const handleQuickQuestionSelect = useCallback(
    (question: string) => {
      if (!question.trim()) return;
      if (!llmConfig || !isConnected) return;
      dismissLandingShader();
      void sendMessage(question, []).then(() => {
        postBridgeEvent("mcp-inspector:chat:message_sent", {
          message: question,
          source: "quick_question",
        });
      });
    },
    [postBridgeEvent, sendMessage, llmConfig, isConnected, dismissLandingShader]
  );

  const handleFollowupSelect = useCallback(
    (followup: string) => {
      if (!followup.trim()) return;
      if (!llmConfig || !isConnected) return;
      void sendMessage(followup, []).then(() => {
        postBridgeEvent("mcp-inspector:chat:message_sent", {
          message: followup,
          source: "followup",
        });
      });
    },
    [postBridgeEvent, sendMessage, llmConfig, isConnected]
  );

  const managedChatNoticeNode =
    managedChatNotice &&
    !(enableFreeTierUpgrade && managedChatNotice.kind === "login_required") ? (
      <ChatManagedNotice
        notice={managedChatNotice}
        onConfigureApiKey={handleConfigureFromNotice}
        onSignIn={
          managedChatNotice.kind === "login_required"
            ? chatApiUrl
              ? handleOpenLogin
              : () => {
                  window.location.href = managedChatNotice.loginUrl;
                }
            : undefined
        }
        authorizing={authorizing}
      />
    ) : null;

  // Show landing form when there are no messages and LLM is configured
  if (llmConfig && messages.length === 0) {
    return wrapWithHistory(
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="absolute top-4 right-4 z-10">
          <ConfigurationDialog
            open={configDialogOpen}
            onOpenChange={setConfigDialogOpen}
            tempProvider={tempProvider}
            tempModel={tempModel}
            tempApiKey={tempApiKey}
            tempBaseUrl={tempBaseUrl}
            onProviderChange={setTempProvider}
            onModelChange={setTempModel}
            onApiKeyChange={setTempApiKey}
            onBaseUrlChange={setTempBaseUrl}
            onSave={handleSaveLLMConfig}
            onClear={handleClearConfig}
            showClearButton={Boolean(localLlmConfig)}
            buttonLabel="Change API Key"
            hostedInspector={enableFreeTierUpgrade}
            freeTierInfo={freeTierInfo}
            managedCloudInfo={managedCloudInfo}
            useManagedCloud={isManaged}
            onSaveManagedCloud={
              managedCloudInfo ? handleSaveManagedCloud : undefined
            }
          />
        </div>

        <ChatLandingForm
          serverDisplayName={getServerDisplayName(connection)}
          composerNotice={managedChatNoticeNode}
          inputValue={inputValue}
          isConnected={
            isConnected && !managedChatNotice && !mcpServerAuthRequired
          }
          isLoading={isLoading}
          textareaRef={textareaRef}
          llmConfig={llmConfig}
          promptsDropdownOpen={promptsDropdownOpen}
          promptFocusedIndex={promptFocusedIndex}
          prompts={filteredPrompts}
          selectedPrompt={selectedPrompt}
          promptResults={results}
          skills={skills}
          enabledSkillUris={enabledSkillUris}
          onEnabledSkillUrisChange={setEnabledSkillUris}
          attachments={attachments}
          tools={hideToolSelector ? undefined : toolInfos}
          disabledTools={hideToolSelector ? undefined : disabledTools}
          onDisabledToolsChange={
            hideToolSelector ? undefined : setDisabledTools
          }
          onDeletePromptResult={handleDeleteResult}
          onPromptSelect={handlePromptSelect}
          onSkillSelect={handleSkillSelect}
          onInputChange={setInputValue}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onClick={updatePromptsDropdownState}
          onSendMessage={handleSendMessage}
          onStopStreaming={stop}
          onConfigDialogOpenChange={setConfigDialogOpen}
          onAttachmentAdd={addAttachment}
          onAttachmentRemove={removeAttachment}
          hideModelBadge={hideInputModelBadge}
          freeTierInfo={freeTierInfo}
          managedCloudInfo={managedCloudInfo}
          modelBadgeMode={modelBadgeMode}
          modelDisplayName={modelDisplayName}
          quickQuestions={quickQuestions}
          onQuickQuestionSelect={handleQuickQuestionSelect}
          pendingElicitationRequests={connection.pendingElicitationRequests}
          onApproveElicitation={connection.approveElicitation}
          onRejectElicitation={connection.rejectElicitation}
          systemPromptProvider={effectiveSystemPromptProvider}
        />
        {reconnectBannerNode}
      </div>
    );
  }

  return wrapWithHistory(
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header. In hosted-managed mode (`freeTierInfo`), the dialog always
          renders and the badge switches to a "Free tier" pill. */}
      <ChatHeader
        llmConfig={llmConfig}
        hasMessages={messages.length > 0}
        configDialogOpen={configDialogOpen}
        onConfigDialogOpenChange={setConfigDialogOpen}
        onClearChat={effectiveChatStorage ? handleNewChat : clearChatToLanding}
        tempProvider={tempProvider}
        tempModel={tempModel}
        tempApiKey={tempApiKey}
        tempBaseUrl={tempBaseUrl}
        onProviderChange={setTempProvider}
        onModelChange={setTempModel}
        onApiKeyChange={setTempApiKey}
        onBaseUrlChange={setTempBaseUrl}
        onSaveConfig={handleSaveLLMConfig}
        onClearConfig={handleClearConfig}
        showClearButton={Boolean(localLlmConfig)}
        hideConfigButton={suppressInspectorModelChrome}
        hostedInspector={enableFreeTierUpgrade}
        freeTierInfo={freeTierInfo}
        managedCloudInfo={managedCloudInfo}
        useManagedCloud={isManaged}
        onSaveManagedCloud={
          managedCloudInfo ? handleSaveManagedCloud : undefined
        }
        onCopyChat={handleCopyChat}
        onExportChat={handleExportChat}
        clearButtonLabel={clearButtonLabel}
        hideTitle={hideTitle}
        clearButtonHideIcon={clearButtonHideIcon}
        clearButtonHideShortcut={clearButtonHideShortcut}
        clearButtonVariant={clearButtonVariant}
        hideClearButton={hideClearButton}
        activeChatId={activeChatId}
        chatTitle={headerDisplayTitle}
        showViewToggle={!!llmConfig}
        viewIndex={activeView === "raw" ? 1 : 0}
        onViewIndexChange={(index) =>
          setActiveView(index === 1 ? "raw" : "conv")
        }
        elevatedHeader={elevatedHeader}
      />

      {/* Messages Area */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatScrollTopFade visible={showTopFade && Boolean(llmConfig)} />
        <div
          ref={messagesAreaRef}
          data-testid="chat-messages-scroll-container"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:p-4 pt-[80px] sm:pt-[100px]"
        >
          {!llmConfig ? (
            <ConfigureEmptyState
              onConfigureClick={() => setConfigDialogOpen(true)}
            />
          ) : activeView === "conv" ? (
            <MessageList
              messages={messages}
              isLoading={isLoading}
              serverId={connection.url}
              readResource={readResource}
              tools={connection.tools}
              sendMessage={sendWidgetMessage}
              modelContextScope={modelContextScope}
              llmConfig={llmConfig}
              serverBaseUrl={connection.url}
              messagesEndRef={messagesEndRef}
              traceEvents={traceEvents}
              authorization={connection.authorization}
              onAuthenticateTool={handleToolAuthentication}
              onRetryTool={handleRetryAuthenticatedTool}
              authenticatingTool={authenticatingTool}
              retryingTool={retryingTool}
            />
          ) : (
            <ChatRawView events={traceEvents} usage={tokenUsage} />
          )}
        </div>

        {llmConfig && (
          <ChatScrollToBottomButton
            visible={showScrollToBottom}
            onClick={() => scrollToBottom("smooth")}
          />
        )}
      </div>

      {llmConfig && (
        <div className="relative shrink-0" data-chat-composer>
          <FullscreenChatOverlay
            messages={messages}
            isLoading={isLoading}
            authorization={connection.authorization}
            onAuthenticateTool={handleToolAuthentication}
            onRetryTool={handleRetryAuthenticatedTool}
            authenticatingTool={authenticatingTool}
            retryingTool={retryingTool}
          />
          {managedChatNoticeNode}
          <ChatInputArea
            variant={isMcpWidgetFullscreen ? "fullscreen" : "default"}
            inputValue={inputValue}
            isConnected={
              isConnected && !managedChatNotice && !mcpServerAuthRequired
            }
            isLoading={isLoading}
            textareaRef={textareaRef}
            llmConfig={llmConfig}
            promptsDropdownOpen={promptsDropdownOpen}
            promptFocusedIndex={promptFocusedIndex}
            prompts={filteredPrompts}
            promptResults={results}
            skills={skills}
            enabledSkillUris={enabledSkillUris}
            onEnabledSkillUrisChange={setEnabledSkillUris}
            selectedPrompt={selectedPrompt}
            attachments={attachments}
            tools={hideToolSelector ? undefined : toolInfos}
            disabledTools={hideToolSelector ? undefined : disabledTools}
            onDisabledToolsChange={
              hideToolSelector ? undefined : setDisabledTools
            }
            onDeletePromptResult={handleDeleteResult}
            onPromptSelect={handlePromptSelect}
            onSkillSelect={handleSkillSelect}
            onInputChange={setInputValue}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onClick={updatePromptsDropdownState}
            onSendMessage={handleSendMessage}
            onStopStreaming={stop}
            onConfigDialogOpenChange={setConfigDialogOpen}
            onAttachmentAdd={addAttachment}
            onAttachmentRemove={removeAttachment}
            hideModelBadge={hideInputModelBadge}
            freeTierInfo={freeTierInfo}
            managedCloudInfo={managedCloudInfo}
            modelBadgeMode={modelBadgeMode}
            modelDisplayName={modelDisplayName}
            followups={followups}
            onFollowupSelect={handleFollowupSelect}
            pendingElicitationRequests={connection.pendingElicitationRequests}
            onApproveElicitation={connection.approveElicitation}
            onRejectElicitation={connection.rejectElicitation}
            systemPromptProvider={effectiveSystemPromptProvider}
          />
        </div>
      )}

      {reconnectBannerNode}
    </div>
  );
}
