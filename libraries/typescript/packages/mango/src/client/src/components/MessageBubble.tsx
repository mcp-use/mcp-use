import React from "react";
import { Streamdown } from "streamdown";
import type { ChatMessage } from "../hooks/useChatStream";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          margin: "8px 0",
        }}
      >
        <div
          style={{
            padding: "4px 12px",
            borderRadius: "12px",
            backgroundColor: "#e3f2fd",
            color: "#1976d2",
            fontSize: "12px",
            fontStyle: "italic",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        margin: "8px 0",
        padding: "0 16px",
      }}
    >
      <div
        style={{
          maxWidth: "70%",
          padding: "12px 16px",
          borderRadius: "16px",
          backgroundColor: isUser ? "#007bff" : "#f1f1f1",
          color: isUser ? "#ffffff" : "#000000",
          wordWrap: "break-word",
        }}
      >
        {/* Render markdown content with Streamdown */}
        <div style={{ marginBottom: "4px", fontSize: "14px" }}>
          {message.content ? (
            <Streamdown
              className="streamdown-content"
              style={{
                color: isUser ? "#ffffff" : "#000000",
              }}
            >
              {message.content}
            </Streamdown>
          ) : null}
        </div>

        {/* Show tool calls if any */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div
            style={{
              marginTop: "8px",
              paddingTop: "8px",
              borderTop: `1px solid ${isUser ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.1)"}`,
            }}
          >
            {message.toolCalls.map((toolCall, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: "12px",
                  opacity: 0.8,
                  marginTop: idx > 0 ? "4px" : "0",
                }}
              >
                🔧 <strong>{toolCall.tool}</strong>
                {toolCall.input && Object.keys(toolCall.input).length > 0 && (
                  <span style={{ marginLeft: "4px" }}>
                    ({JSON.stringify(toolCall.input)})
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            fontSize: "10px",
            opacity: 0.7,
            marginTop: "4px",
          }}
        >
          {message.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
