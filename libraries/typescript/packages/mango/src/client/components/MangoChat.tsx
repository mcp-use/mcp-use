/**
 * MangoChat - Main chat interface for Mango
 */

import React, { useEffect, useRef, useState } from "react";
import type { LLMConfig } from "../hooks/useMango.js";
import { useMango } from "../hooks/useMango.js";

export interface MangoChatProps {
  onClose: () => void;
  llmConfig?: LLMConfig;
  onServerCreated?: (serverUrl: string, projectName: string) => void;
  className?: string;
}

export function MangoChat({
  onClose,
  llmConfig,
  onServerCreated,
  className = "",
}: MangoChatProps) {
  const [inputValue, setInputValue] = useState("");
  const [showConfig, setShowConfig] = useState(!llmConfig);
  const [tempApiKey, setTempApiKey] = useState(llmConfig?.apiKey || "");
  const [configError, setConfigError] = useState<string | null>(null);
  const [tempProvider, setTempProvider] = useState<
    "openai" | "anthropic" | "google"
  >(llmConfig?.provider || "openai");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    setLLMConfig,
  } = useMango({
    llmConfig,
    onServerCreated,
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [showConfig]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    await sendMessage(inputValue);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSaveConfig = () => {
    if (!tempApiKey.trim()) {
      setConfigError("API key is required");
      return;
    }

    setConfigError(null);
    setLLMConfig({
      provider: tempProvider,
      apiKey: tempApiKey,
      model: undefined, // Use default model for provider
    });
    setShowConfig(false);
  };

  return (
    <div
      className={`
        fixed inset-0 z-40 flex items-center justify-center
        bg-black/50 backdrop-blur-sm
        ${className}
      `}
      onClick={onClose}
    >
      <div
        className="
          bg-white dark:bg-zinc-900
          rounded-2xl shadow-2xl
          w-full max-w-3xl h-[600px]
          flex flex-col
          border border-zinc-200 dark:border-zinc-700
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🥭</span>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Mango
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                AI Assistant for MCP Servers
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="
                px-3 py-1 rounded-lg text-sm
                bg-zinc-100 dark:bg-zinc-800
                hover:bg-zinc-200 dark:hover:bg-zinc-700
                text-zinc-700 dark:text-zinc-300
                transition-colors
              "
            >
              ⚙️ Config
            </button>
            <button
              onClick={clearMessages}
              className="
                px-3 py-1 rounded-lg text-sm
                bg-zinc-100 dark:bg-zinc-800
                hover:bg-zinc-200 dark:hover:bg-zinc-700
                text-zinc-700 dark:text-zinc-300
                transition-colors
              "
              disabled={messages.length === 0}
            >
              🗑️ Clear
            </button>
            <button
              onClick={onClose}
              className="
                p-2 rounded-lg
                hover:bg-zinc-100 dark:hover:bg-zinc-800
                text-zinc-500 dark:text-zinc-400
                transition-colors
              "
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Config Panel */}
        {showConfig && (
          <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
            <h3 className="text-sm font-semibold mb-3 text-zinc-900 dark:text-zinc-100">
              LLM Configuration
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm mb-1 text-zinc-700 dark:text-zinc-300">
                  Provider
                </label>
                <select
                  value={tempProvider}
                  onChange={(e) =>
                    setTempProvider(
                      e.target.value as "openai" | "anthropic" | "google"
                    )
                  }
                  className="
                    w-full px-3 py-2 rounded-lg text-sm
                    bg-white dark:bg-zinc-900
                    border border-zinc-300 dark:border-zinc-600
                    text-zinc-900 dark:text-zinc-100
                  "
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google</option>
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-zinc-700 dark:text-zinc-300">
                  API Key
                </label>
                <input
                  type="password"
                  value={tempApiKey}
                  onChange={(e) => {
                    setTempApiKey(e.target.value);
                    setConfigError(null);
                  }}
                  placeholder="Enter your API key"
                  className="
                    w-full px-3 py-2 rounded-lg text-sm
                    bg-white dark:bg-zinc-900
                    border border-zinc-300 dark:border-zinc-600
                    text-zinc-900 dark:text-zinc-100
                    placeholder:text-zinc-400 dark:placeholder:text-zinc-500
                  "
                />
              </div>
              {configError && (
                <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {configError}
                  </p>
                </div>
              )}
              <button
                onClick={handleSaveConfig}
                className="
                  w-full px-4 py-2 rounded-lg text-sm font-medium
                  bg-orange-500 hover:bg-orange-600
                  text-white
                  transition-colors
                "
              >
                Save Configuration
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && !showConfig && (
            <div className="flex items-center justify-center h-full text-center">
              <div className="space-y-2">
                <div className="text-5xl">🥭</div>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Hi! I'm Mango, your AI assistant for creating MCP servers.
                </p>
                <p className="text-sm text-zinc-500 dark:text-zinc-500">
                  What would you like to build today?
                </p>
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`
                flex gap-3
                ${message.role === "user" ? "justify-end" : "justify-start"}
              `}
            >
              {message.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">🥭</span>
                </div>
              )}
              <div
                className={`
                  max-w-[80%] px-4 py-2 rounded-2xl
                  ${
                    message.role === "user"
                      ? "bg-orange-500 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                  }
                `}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              </div>
              {message.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-zinc-300 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">👤</span>
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center">
                <span className="text-lg">🥭</span>
              </div>
              <div className="bg-zinc-100 dark:bg-zinc-800 px-4 py-2 rounded-2xl">
                <div className="flex gap-1">
                  <div
                    className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <div
                    className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <div
                    className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-600 dark:text-red-400">
                ❌ {error}
              </p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        {!showConfig && (
          <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Mango to create or edit an MCP server..."
                disabled={isLoading}
                rows={1}
                className="
                  flex-1 px-4 py-2 rounded-xl text-sm
                  bg-zinc-100 dark:bg-zinc-800
                  border border-zinc-200 dark:border-zinc-700
                  text-zinc-900 dark:text-zinc-100
                  placeholder:text-zinc-400 dark:placeholder:text-zinc-500
                  resize-none
                  focus:outline-none focus:ring-2 focus:ring-orange-500
                  disabled:opacity-50
                "
                style={{ minHeight: "40px", maxHeight: "120px" }}
              />
              <button
                onClick={handleSendMessage}
                disabled={isLoading || !inputValue.trim()}
                className="
                  px-6 py-2 rounded-xl
                  bg-orange-500 hover:bg-orange-600
                  disabled:bg-zinc-300 dark:disabled:bg-zinc-700
                  text-white
                  transition-colors
                  disabled:cursor-not-allowed
                "
              >
                {isLoading ? "..." : "Send"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
