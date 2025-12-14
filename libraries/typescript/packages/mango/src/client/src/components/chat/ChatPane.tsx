import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, PanelLeftOpen, PanelRightOpen, Plus } from "lucide-react";
import { useAppState } from "../../store/app";
import { useChatStream } from "../../hooks/useChatStream";
import { ToolCallDisplay } from "./ToolCallDisplay";

export function ChatPane() {
  const chatWidth = useAppState((state) => state.chatWidth);
  const setChatWidth = useAppState((state) => state.setChatWidth);
  const setDevServerUrl = useAppState((state) => state.setDevServerUrl);

  const [isOpen, setIsOpen] = useState(true);
  const [isResizing, setIsResizing] = useState(false);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const minWidth = 300;
  const maxWidth = 800;

  const {
    messages,
    isStreaming,
    error,
    devServerUrl,
    sendMessage,
    clearMessages,
  } = useChatStream();

  // Update dev server URL in app state
  useEffect(() => {
    if (devServerUrl) {
      setDevServerUrl(devServerUrl);
    }
  }, [devServerUrl, setDevServerUrl]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = e.clientX - 32;
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      setChatWidth(clampedWidth);
    },
    [isResizing, minWidth, maxWidth, setChatWidth]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Add/remove global mouse event listeners
  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isStreaming) {
      await sendMessage(input);
      setInput("");
    }
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "-100%", opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="fixed left-8 top-[80px] z-50 h-[calc(100vh-120px)]"
            style={{ width: `${chatWidth}px` }}
          >
            <div
              className={`h-full w-full group rounded-xl shadow-xl backdrop-blur-sm bg-white relative ${
                isResizing ? "select-none" : ""
              }`}
            >
              {/* Resize overlay */}
              {isResizing && (
                <div className="absolute inset-0 bg-black/5 backdrop-blur-sm pointer-events-none z-20" />
              )}

              {/* Resize handle */}
              <div
                className={`absolute right-0 top-[20px] h-[calc(100%-40px)] rounded-full bottom-0 w-2 transition-colors duration-150 z-10 ${
                  isResizing ? "bg-stone-500" : "bg-white hover:bg-stone-100"
                }`}
                onMouseDown={handleMouseDown}
                style={{ cursor: "col-resize" }}
              >
                <div className="absolute left-1/2 top-1/2 transform -translate-x-[10px] -translate-y-1/2 flex flex-col gap-0.5 bg-stone-300 rounded-full p-1">
                  <div
                    className={`w-0.5 h-0.5 rounded-full ${
                      isResizing ? "bg-white" : "bg-stone-800"
                    }`}
                  />
                  <div
                    className={`w-0.5 h-0.5 rounded-full ${
                      isResizing ? "bg-white" : "bg-stone-800"
                    }`}
                  />
                  <div
                    className={`w-0.5 h-0.5 rounded-full ${
                      isResizing ? "bg-white" : "bg-stone-800"
                    }`}
                  />
                </div>
              </div>

              {/* Collapse button */}
              <button
                onClick={() => setIsOpen(false)}
                title="Close chat"
                className="absolute -translate-x-3 group-hover:translate-x-0 -right-12 group-hover:opacity-100 opacity-0 top-[calc(50%-16px)] z-20 text-stone-500 cursor-pointer hover:text-black bg-white rounded-full p-2 size-8 flex items-center justify-center hover:bg-stone-100 hover:scale-105 transition-all duration-150 ease-in-out shadow-sm border border-stone-200"
              >
                <PanelRightOpen className="size-4" strokeWidth={1.5} />
              </button>

              <div className="flex h-full w-full">
                {/* Main chat area */}
                <div className="relative flex-grow overflow-hidden">
                  <div className="flex h-full flex-col" style={{ opacity: 1 }}>
                    {/* Header */}
                    <header className="flex h-[64px] flex-shrink-0 items-center justify-between border-b border-black/5 px-5">
                      <h2 className="text-base font-semibold text-[#555555]">
                        Chat
                      </h2>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={clearMessages}
                          title="New chat"
                          className="text-stone-100 cursor-pointer hover:text-white bg-stone-800 rounded-full p-2 size-10 flex items-center justify-center hover:bg-stone-900 hover:scale-105 transition-all duration-150 ease-in-out"
                        >
                          <Plus className="size-5" />
                        </button>
                      </div>
                    </header>

                    {/* Messages area */}
                    <div className="flex-grow overflow-hidden px-6">
                      <div className="flex h-full flex-col overflow-y-auto">
                        <div className="flex-grow space-y-4 py-6 text-base">
                          {/* Welcome message */}
                          {messages.length === 0 && !error && (
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3 }}
                              className="flex w-full items-start gap-3 flex-col justify-start"
                            >
                              <div className="max-w-[90%]">
                                <p className="leading-relaxed text-sm text-[#555555] mb-4">
                                  Hi! I'm Mango, your MCP server building
                                  assistant. Tell me what kind of server you'd
                                  like to build!
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    onClick={() => {
                                      setInput("Build a weather MCP server");
                                      inputRef.current?.focus();
                                    }}
                                    className="px-3 py-1.5 rounded-full border border-stone-300 text-stone-600 text-sm hover:bg-stone-50 transition-colors"
                                  >
                                    Weather server
                                  </button>
                                  <button
                                    onClick={() => {
                                      setInput(
                                        "Create a file system MCP server"
                                      );
                                      inputRef.current?.focus();
                                    }}
                                    className="px-3 py-1.5 rounded-full border border-stone-300 text-stone-600 text-sm hover:bg-stone-50 transition-colors"
                                  >
                                    File system
                                  </button>
                                  <button
                                    onClick={() => {
                                      setInput("Build a database query server");
                                      inputRef.current?.focus();
                                    }}
                                    className="px-3 py-1.5 rounded-full border border-stone-300 text-stone-600 text-sm hover:bg-stone-50 transition-colors"
                                  >
                                    Database tools
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          )}

                          {/* Messages */}
                          {messages.map((message, index) => (
                            <motion.div
                              key={message.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3 }}
                              className={`flex w-full items-start gap-3 ${
                                message.role === "user"
                                  ? "justify-end"
                                  : "flex-col justify-start"
                              }`}
                            >
                              {message.role === "user" ? (
                                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-stone-200 px-6 py-4 text-stone-700">
                                  <p className="leading-relaxed text-sm font-medium">
                                    {message.content}
                                  </p>
                                </div>
                              ) : message.role === "system" ? (
                                <div className="max-w-[90%]">
                                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                    <p className="text-xs text-blue-700 font-medium">
                                      {message.content}
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div className="w-full space-y-4">
                                  {/* Text content */}
                                  {message.parts
                                    ?.filter((part) => part.type === "text")
                                    .map((part, partIndex) => (
                                      <div
                                        key={partIndex}
                                        className="max-w-[90%]"
                                      >
                                        <p className="leading-relaxed text-sm text-[#555555]">
                                          {part.content}
                                        </p>
                                      </div>
                                    ))}

                                  {/* Tool calls */}
                                  {message.parts
                                    ?.filter(
                                      (part) => part.type === "tool_call"
                                    )
                                    .map((part, partIndex) => (
                                      <ToolCallDisplay
                                        key={partIndex}
                                        part={part as any}
                                      />
                                    ))}
                                </div>
                              )}
                            </motion.div>
                          ))}

                          {/* Error message */}
                          {error && (
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3 }}
                              className="flex w-full items-start gap-3 flex-col justify-start"
                            >
                              <div className="max-w-[90%]">
                                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                  <p className="text-sm text-red-700">
                                    {error}
                                  </p>
                                </div>
                              </div>
                            </motion.div>
                          )}

                          {/* Loading indicator */}
                          {isStreaming && (
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3 }}
                              className="flex w-full items-start gap-3 flex-col justify-start"
                            >
                              <div className="max-w-[90%]">
                                <div className="flex items-center gap-2 text-sm text-gray-500">
                                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                                  <span>Building MCP server...</span>
                                </div>
                              </div>
                            </motion.div>
                          )}

                          <div ref={messagesEndRef} />
                        </div>
                      </div>
                    </div>

                    {/* Input area */}
                    <div className="flex-shrink-0 py-4 px-5">
                      <form onSubmit={onSubmit}>
                        <div
                          className="flex flex-col gap-3 rounded-[28px] p-3"
                          style={{
                            background: "rgba(225, 225, 225, 0.75)",
                            backdropFilter: "blur(10px)",
                          }}
                        >
                          <div className="flex items-center gap-2 py-2">
                            <input
                              ref={inputRef}
                              value={input}
                              onChange={(e) => setInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  if (input.trim() && !isStreaming) {
                                    onSubmit(e);
                                  }
                                }
                              }}
                              className="flex-grow px-2 text-base focus:outline-none text-[#555555] placeholder:text-[#999999] bg-transparent border-none"
                              style={{ lineHeight: "1.5" }}
                              placeholder="Type your message..."
                              disabled={isStreaming}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2" />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={onSubmit}
                                type="submit"
                                disabled={!input.trim() || isStreaming}
                                title="Send message"
                                className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium disabled:pointer-events-none disabled:opacity-50 px-4 py-2 h-10 w-[52px] rounded-full transition-all duration-150 ease-in-out hover:scale-105 bg-white text-[#555555] shadow-[0_2px_4px_0_rgba(0,0,0,0.05)] hover:bg-gray-100"
                              >
                                <ArrowUp
                                  style={{ width: "20px", height: "20px" }}
                                />
                              </button>
                            </div>
                          </div>
                        </div>
                      </form>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
        {!isOpen && (
          <button
            className="fixed -left-2 top-[50vh] z-50 bg-white border rounded-full p-2 shadow-xl hover:scale-105 transition-all duration-150 ease-in-out hover:bg-stone-100 text-stone-500 size-12 flex items-center justify-center"
            onClick={() => setIsOpen(true)}
            title="Open chat"
          >
            <PanelLeftOpen className="size-6" />
          </button>
        )}
      </AnimatePresence>
    </>
  );
}
