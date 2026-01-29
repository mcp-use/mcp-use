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

interface ChatTabProps {
  connection: MCPConnection;
  isConnected: boolean;
  useClientSide?: boolean;
  prompts: Prompt[];
  serverId: string;
  readResource?: (uri: string) => Promise<any>;
  callPrompt: (name: string, args?: Record<string, unknown>) => Promise<any>;
}

// Check text up to caret position for " /" or "/" at start of line or textarea
const PROMPT_TRIGGER_REGEX = /(?:^\/$|\s+\/$)/;
// Keys that trigger prompt dropdown actions if promptsDropdownOpen is true
const PROMPT_ARROW_KEYS = ["ArrowDown", "ArrowUp", "Escape", "Enter"];

export function ChatTab({
  connection,
  isConnected,
  useClientSide = true,
  prompts,
  serverId,
  callPrompt,
  readResource,
}: ChatTabProps) {
  const [inputValue, setInputValue] = useState("");
  const [promptsDropdownOpen, setPromptsDropdownOpen] = useState(false);
  const [promptFocusedIndex, setPromptFocusedIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Track position of trigger for removal in textarea
  const triggerSpanRef = useRef<{ start: number; end: number } | null>(null);

  // Use custom hooks for configuration, chat messages and mcp prompts handling
  const {
    llmConfig,
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

  // Register keyboard shortcuts (only active when ChatTab is mounted)
  useKeyboardShortcuts({
    onNewChat: clearMessages,
  });

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

  // Show landing form when there are no messages and LLM is configured
  if (llmConfig && messages.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Header with config dialog */}
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
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
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
            sendMessage={sendMessage}
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
        />
      )}
    </div>
  );
}
