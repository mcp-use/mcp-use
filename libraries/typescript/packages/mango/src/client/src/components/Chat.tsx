import React from "react";
import { useChatStream } from "../hooks/useChatStream";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";

export function Chat() {
  const { messages, isStreaming, error, sendMessage, clearMessages } =
    useChatStream();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        maxWidth: "1200px",
        margin: "0 auto",
        backgroundColor: "#ffffff",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid #e0e0e0",
          backgroundColor: "#f8f9fa",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "20px", fontWeight: "600" }}>
          🥭 Mango Agent
        </h1>
        <button
          onClick={clearMessages}
          style={{
            padding: "6px 12px",
            borderRadius: "6px",
            border: "1px solid #e0e0e0",
            backgroundColor: "#ffffff",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <MessageList messages={messages} />

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#fee",
            color: "#c00",
            fontSize: "14px",
            borderTop: "1px solid #fcc",
          }}
        >
          Error: {error}
        </div>
      )}

      {/* Input */}
      <MessageInput onSend={sendMessage} disabled={isStreaming} />

      {/* Status Indicator */}
      {isStreaming && (
        <div
          style={{
            padding: "8px 16px",
            backgroundColor: "#e3f2fd",
            color: "#1976d2",
            fontSize: "12px",
            textAlign: "center",
          }}
        >
          Agent is working...
        </div>
      )}
    </div>
  );
}
