import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "mcp-use/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useMCPPrompts } from "../hooks/useMCPPrompts";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatInputArea } from "./chat/ChatInputArea";
import { ChatLandingForm } from "./chat/ChatLandingForm";
import { ConfigurationDialog } from "./chat/ConfigurationDialog";
import { ConfigureEmptyState } from "./chat/ConfigureEmptyState";
import { MessageList } from "./chat/MessageList";
import { useChatMessages } from "./chat/useChatMessages";
import { useChatMessagesClientSide } from "./chat/useChatMessagesClientSide";
import { useConfig } from "./chat/useConfig";

// Type alias for backward compatibility
type MCPConnection = McpServer;
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
  /** Initial quick questions shown below the landing input. */
  chatQuickQuestions?: string[];
  /** Initial followups shown above input in active chat mode. */
  chatFollowups?: string[];
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
  managedLlmConfig,
  clearButtonLabel,
  hideTitle,
  hideModelBadge,
  hideServerUrl,
  clearButtonHideIcon,
  clearButtonHideShortcut,
  clearButtonVariant,
  chatQuickQuestions = [],
  chatFollowups = [],
}: ChatTabProps) {
  const [inputValue, setInputValue] = useState("");
  const [promptsDropdownOpen, setPromptsDropdownOpen] = useState(false);
  const [promptFocusedIndex, setPromptFocusedIndex] = useState(-1);
  const [quickQuestions, setQuickQuestions] =
    useState<string[]>(chatQuickQuestions);
  const [followups, setFollowups] = useState<string[]>(chatFollowups);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Track position of trigger for removal in textarea
  const triggerSpanRef = useRef<{ start: number; end: number } | null>(null);

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

  // If a managed LLM config is provided externally, use it instead of localStorage config
  const llmConfig = managedLlmConfig ?? localLlmConfig;
  const isManaged = !!managedLlmConfig;

  // Use client-side or server-side chat implementation
  const chatHookParams = {
    connection,
    llmConfig,
    isConnected,
    readResource,
  };

  const serverSideChat = useChatMessages({
    mcpServerUrl: connection.url,
    llmConfig,
    authConfig: userAuthConfig,
    isConnected,
    chatApiUrl,
  });
  const clientSideChat = useChatMessagesClientSide(chatHookParams);

  const {
    messages,
    isLoading,
    attachments,
    sendMessage,
    clearMessages,
    stop,
    addAttachment,
    removeAttachment,
  } = useClientSide ? clientSideChat : serverSideChat;

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
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((item) => (typeof item === "string" ? item : (item.text ?? "")))
        .join("");
    }
    return "";
  }, []);

  const getSerializedMessages = useCallback(() => {
    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: serializeMessageContent(message),
      timestamp: message.timestamp,
    }));
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
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    clearMessages,
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

  // Show landing form when there are no messages and LLM is configured
  if (llmConfig && messages.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Header with config dialog (hidden when externally managed) */}
        {!isManaged && (
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
              showClearButton
              buttonLabel="Change API Key"
            />
          </div>
        )}

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
          hideModelBadge={hideModelBadge}
          hideServerUrl={hideServerUrl}
          quickQuestions={quickQuestions}
          onQuickQuestionSelect={handleQuickQuestionSelect}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header (hide config controls when externally managed) */}
      <ChatHeader
        llmConfig={llmConfig}
        hasMessages={messages.length > 0}
        configDialogOpen={isManaged ? false : configDialogOpen}
        onConfigDialogOpenChange={isManaged ? () => {} : setConfigDialogOpen}
        onClearChat={clearMessages}
        tempProvider={tempProvider}
        tempModel={tempModel}
        tempApiKey={tempApiKey}
        onProviderChange={setTempProvider}
        onModelChange={setTempModel}
        onApiKeyChange={setTempApiKey}
        onSaveConfig={saveLLMConfig}
        onClearConfig={handleClearConfig}
        hideConfigButton={isManaged}
        clearButtonLabel={clearButtonLabel}
        hideTitle={hideTitle}
        clearButtonHideIcon={clearButtonHideIcon}
        clearButtonHideShortcut={clearButtonHideShortcut}
        clearButtonVariant={clearButtonVariant}
      />

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-4 pt-[80px] sm:pt-[100px]">
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
            sendMessage={(msg) => sendMessage(msg, [])}
            serverBaseUrl={connection.url}
          />
        )}
      </div>

      {/* Input Area */}
      {llmConfig && (
        <ChatInputArea
          inputValue={inputValue}
          isConnected={isConnected}
          isLoading={isLoading}
          textareaRef={textareaRef}
          promptsDropdownOpen={promptsDropdownOpen}
          promptFocusedIndex={promptFocusedIndex}
          prompts={filteredPrompts}
          promptResults={results}
          selectedPrompt={selectedPrompt}
          attachments={attachments}
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
