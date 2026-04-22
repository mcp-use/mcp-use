import type {
  CallToolResult,
  ContentBlock,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "mcp-use/react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { copyToClipboard } from "../utils/clipboard";
import { downloadJSON } from "../utils/jsonUtils";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useMCPPrompts } from "../hooks/useMCPPrompts";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatInputArea } from "./chat/ChatInputArea";
import { ChatLandingForm } from "./chat/ChatLandingForm";
import { ConfigurationDialog } from "./chat/ConfigurationDialog";
import { ConfigureEmptyState } from "./chat/ConfigureEmptyState";
import { MessageList } from "./chat/MessageList";
import type { ToolInfo } from "./chat/ToolSelector";
import { useChatMessages } from "./chat/useChatMessages";
import { useChatMessagesClientSide } from "./chat/useChatMessagesClientSide";
import { useConfig } from "./chat/useConfig";
import { useWidgetDebug } from "../context/WidgetDebugContext";
import { LoginModal } from "./LoginModal";

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
   * Use to send only `{ messages }` to a server-managed backend.
   */
  body?: (
    messages: Array<{ role: string; content: unknown; attachments?: unknown }>
  ) => unknown;
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
  clearButtonLabel,
  hideTitle,
  hideModelBadge,
  hideServerUrl,
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
}: ChatTabProps) {
  const [inputValue, setInputValue] = useState("");
  const [promptsDropdownOpen, setPromptsDropdownOpen] = useState(false);
  const [promptFocusedIndex, setPromptFocusedIndex] = useState(-1);
  const [quickQuestions, setQuickQuestions] =
    useState<string[]>(chatQuickQuestions);
  const [followups, setFollowups] = useState<string[]>(chatFollowups);
  const [disabledTools, setDisabledTools] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesAreaRef = useRef<HTMLDivElement | null>(null);
  // Track position of trigger for removal in textarea
  const triggerSpanRef = useRef<{ start: number; end: number } | null>(null);

  const toolInfos: ToolInfo[] = useMemo(
    () =>
      (connection.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
      })),
    [connection.tools]
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
    saveLLMConfig,
    clearConfig,
  } = useConfig({ mcpServerUrl: connection.url });

  // ── Hosted-mode / client-side override ──────────────────────────────────
  // In hosted mode the parent passes `useClientSide=false` and sets `chatApiUrl`
  // to the Manufact backend (inspector.manufact.com/api/v1/inspector/chat/stream).
  // We *still* want client-side mode in two situations:
  //
  //  a) User already has their own API key stored in localStorage → auto-detect
  //     on mount via `localLlmConfig`. The model selector is then naturally
  //     visible (ChatLandingForm / ConfigurationDialog take over).
  //
  //  b) User clicks "Use your own API key" in LoginModal (shown on 429) →
  //     `handleUseApiKey` sets forceClientSide=true and opens ConfigurationDialog.
  //
  // `effectiveClientSide` is the single source of truth used everywhere below
  // instead of the raw `useClientSide` prop.
  const [forceClientSide, setForceClientSide] = useState(
    () => !!localLlmConfig
  );
  const effectiveClientSide =
    useClientSide || forceClientSide || !!localLlmConfig;

  // When the user has opted into client-side mode (own API key), ignore the
  // externally-provided managed config — we want the config dialog, model
  // selector, and local llmConfig to take over. Without this, clicking "Use
  // your own API key" in the LoginModal would leave `isManaged=true`, hiding
  // the ConfigurationDialog and config button.
  const llmConfig = effectiveClientSide
    ? localLlmConfig
    : (managedLlmConfig ?? localLlmConfig);
  const isManaged = !effectiveClientSide && !!managedLlmConfig;

  const { getAllModelContexts } = useWidgetDebug();

  const widgetModelContexts = getAllModelContexts();

  // Use client-side or server-side chat implementation
  const chatHookParams = {
    connection,
    llmConfig,
    isConnected,
    readResource,
    widgetModelContexts,
    disabledTools,
  };

  const serverSideChat = useChatMessages({
    mcpServerUrl: connection.url,
    llmConfig,
    authConfig: userAuthConfig,
    isConnected,
    chatApiUrl,
    waitForChatApiUrl,
    widgetModelContexts,
    initialMessages,
    disabledTools,
    streamProtocol,
    credentials,
    extraHeaders,
    body,
  });
  const clientSideChat = useChatMessagesClientSide(chatHookParams);

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
  } = effectiveClientSide ? clientSideChat : serverSideChat;

  const rateLimitInfo = effectiveClientSide
    ? null
    : (serverSideChat.rateLimitInfo ?? null);

  const clearRateLimitInfo = effectiveClientSide
    ? undefined
    : serverSideChat.clearRateLimitInfo;

  // Called when user clicks "Use your own API key" in the rate-limit modal.
  const handleUseApiKey = useCallback(() => {
    clearRateLimitInfo?.();
    setForceClientSide(true);
    setConfigDialogOpen(true);
  }, [clearRateLimitInfo, setConfigDialogOpen]);

  // User-initiated login (from the free-tier badge / ConfigurationDialog CTA).
  // Separate from `rateLimitInfo` which is reactive to a 429 response.
  const [showLoginModal, setShowLoginModal] = useState(false);
  const handleOpenLogin = useCallback(() => {
    setConfigDialogOpen(false);
    setShowLoginModal(true);
  }, [setConfigDialogOpen]);

  // Free-tier info is shown whenever the chat is in hosted-managed mode.
  const freeTierInfo = isManaged
    ? { onLoginClick: handleOpenLogin }
    : undefined;

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
        clearMessages();
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
    clearMessages,
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
    enableKeyboardShortcuts ? { onNewChat: clearMessages } : {}
  );

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

  const handleSendMessage = useCallback(() => {
    // Can send if there's text, prompt results, or attachments
    const hasContent =
      inputValue.trim() || results.length > 0 || attachments.length > 0;
    if (!hasContent) {
      return;
    }
    sendMessage(inputValue, results);
    setInputValue("");
    clearPromptResults();
  }, [inputValue, results, sendMessage, clearPromptResults, attachments]);

  const handlePromptKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "ArrowDown") {
        setPromptFocusedIndex((prev) => {
          if (filteredPrompts.length === 0) return -1;
          return (prev + 1) % filteredPrompts.length;
        });
      } else if (e.key === "ArrowUp") {
        setPromptFocusedIndex((prev) => {
          if (filteredPrompts.length === 0) return -1;
          return (prev - 1 + filteredPrompts.length) % filteredPrompts.length;
        });
      } else if (e.key === "Escape") {
        e.stopPropagation();
        clearPromptsUIState();
      } else if (e.key === "Enter" && promptFocusedIndex >= 0) {
        const prompt = filteredPrompts[promptFocusedIndex];
        if (prompt) {
          handlePromptSelect(prompt);
        }
      }
    },
    [
      filteredPrompts,
      promptFocusedIndex,
      handlePromptSelect,
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
    clearMessages();
  }, [clearConfig, clearMessages]);

  const handleQuickQuestionSelect = useCallback(
    (question: string) => {
      if (!question.trim()) return;
      if (!llmConfig || !isConnected) return;
      void sendMessage(question, []).then(() => {
        postBridgeEvent("mcp-inspector:chat:message_sent", {
          message: question,
          source: "quick_question",
        });
      });
    },
    [postBridgeEvent, sendMessage, llmConfig, isConnected]
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

  // Login modal — shown on 429 rate-limit OR when the user clicks "Sign in"
  // from the free-tier ConfigurationDialog. Rendered in both the landing and
  // main-chat branches so it works before any message is sent too.
  const loginModalNode =
    (rateLimitInfo || showLoginModal) && chatApiUrl ? (
      <LoginModal
        authOrigin={new URL(chatApiUrl).origin}
        onDismiss={() => {
          clearRateLimitInfo?.();
          setShowLoginModal(false);
        }}
        onUseApiKey={handleUseApiKey}
      />
    ) : null;

  // Show landing form when there are no messages and LLM is configured
  if (llmConfig && messages.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Header with config dialog. In hosted-managed mode the dialog shows
            a "free tier" banner + Sign-in CTA above the bring-your-own-key form. */}
        <div className="absolute top-4 right-4 z-10">
          <ConfigurationDialog
            open={configDialogOpen}
            onOpenChange={setConfigDialogOpen}
            tempProvider={tempProvider}
            tempModel={tempModel}
            tempApiKey={tempApiKey}
            onProviderChange={setTempProvider}
            onModelChange={setTempModel}
            onApiKeyChange={setTempApiKey}
            onSave={saveLLMConfig}
            onClear={handleClearConfig}
            showClearButton={!isManaged}
            buttonLabel="Change API Key"
            freeTierInfo={freeTierInfo}
          />
        </div>

        {/* Landing Form */}
        <ChatLandingForm
          mcpServerUrl={connection.url}
          inputValue={inputValue}
          isConnected={isConnected}
          isLoading={isLoading}
          textareaRef={textareaRef}
          llmConfig={llmConfig}
          promptsDropdownOpen={promptsDropdownOpen}
          promptFocusedIndex={promptFocusedIndex}
          prompts={filteredPrompts}
          selectedPrompt={selectedPrompt}
          promptResults={results}
          attachments={attachments}
          tools={hideToolSelector ? undefined : toolInfos}
          disabledTools={hideToolSelector ? undefined : disabledTools}
          onDisabledToolsChange={
            hideToolSelector ? undefined : setDisabledTools
          }
          onDeletePromptResult={handleDeleteResult}
          onPromptSelect={handlePromptSelect}
          onInputChange={setInputValue}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onClick={updatePromptsDropdownState}
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          onConfigDialogOpenChange={setConfigDialogOpen}
          onAttachmentAdd={addAttachment}
          onAttachmentRemove={removeAttachment}
          hideModelBadge={
            // In hosted mode the host default is `hideModelBadge=true`, but
            // once the user has supplied their own API key (client-side mode)
            // we want the provider/model badge back so they can see and
            // change what they're using.
            hideModelBadge && !effectiveClientSide
          }
          hideServerUrl={hideServerUrl}
          quickQuestions={quickQuestions}
          onQuickQuestionSelect={handleQuickQuestionSelect}
          freeTierInfo={freeTierInfo}
        />
        {loginModalNode}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header. In hosted-managed mode (`freeTierInfo`), the dialog always
          renders and the badge switches to a "Free tier" pill. */}
      <ChatHeader
        llmConfig={llmConfig}
        hasMessages={messages.length > 0}
        configDialogOpen={configDialogOpen}
        onConfigDialogOpenChange={setConfigDialogOpen}
        onClearChat={clearMessages}
        tempProvider={tempProvider}
        tempModel={tempModel}
        tempApiKey={tempApiKey}
        onProviderChange={setTempProvider}
        onModelChange={setTempModel}
        onApiKeyChange={setTempApiKey}
        onSaveConfig={saveLLMConfig}
        onClearConfig={handleClearConfig}
        hideConfigButton={isManaged && !freeTierInfo}
        freeTierInfo={freeTierInfo}
        onCopyChat={handleCopyChat}
        onExportChat={handleExportChat}
        clearButtonLabel={clearButtonLabel}
        hideTitle={hideTitle}
        clearButtonHideIcon={clearButtonHideIcon}
        clearButtonHideShortcut={clearButtonHideShortcut}
        clearButtonVariant={clearButtonVariant}
        hideClearButton={hideClearButton}
      />

      {/* Messages Area */}
      <div
        ref={messagesAreaRef}
        className="flex-1 overflow-y-auto p-2 sm:p-4 pt-[80px] sm:pt-[100px]"
      >
        {!llmConfig ? (
          <ConfigureEmptyState
            onConfigureClick={() => setConfigDialogOpen(true)}
          />
        ) : (
          <MessageList
            messages={messages}
            isLoading={isLoading}
            serverId={connection.url}
            readResource={readResource}
            tools={connection.tools}
            sendMessage={(msg, atts) => sendMessage(msg, [], atts)}
            serverBaseUrl={connection.url}
            pendingElicitationRequests={connection.pendingElicitationRequests}
            onApproveElicitation={connection.approveElicitation}
            onRejectElicitation={connection.rejectElicitation}
          />
        )}
      </div>

      {loginModalNode}

      {/* Input Area */}
      {llmConfig && (
        <ChatInputArea
          inputValue={inputValue}
          isConnected={isConnected && !rateLimitInfo}
          isLoading={isLoading}
          textareaRef={textareaRef}
          promptsDropdownOpen={promptsDropdownOpen}
          promptFocusedIndex={promptFocusedIndex}
          prompts={filteredPrompts}
          promptResults={results}
          selectedPrompt={selectedPrompt}
          attachments={attachments}
          tools={hideToolSelector ? undefined : toolInfos}
          disabledTools={hideToolSelector ? undefined : disabledTools}
          onDisabledToolsChange={
            hideToolSelector ? undefined : setDisabledTools
          }
          onDeletePromptResult={handleDeleteResult}
          onPromptSelect={handlePromptSelect}
          onInputChange={setInputValue}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onClick={updatePromptsDropdownState}
          onSendMessage={handleSendMessage}
          onStopStreaming={stop}
          onAttachmentAdd={addAttachment}
          onAttachmentRemove={removeAttachment}
          followups={followups}
          onFollowupSelect={handleFollowupSelect}
        />
      )}
    </div>
  );
}
