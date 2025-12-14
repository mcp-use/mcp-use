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

  // Use parts if available for linear flow, otherwise fall back to content + toolCalls
  const hasParts = message.parts && message.parts.length > 0;

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
        {hasParts ? (
          // Render parts in chronological order
          <div style={{ fontSize: "14px" }}>
            {message.parts!.map((part, idx) => {
              if (part.type === "text") {
                return (
                  <div
                    key={idx}
                    style={{
                      marginBottom:
                        idx < message.parts!.length - 1 ? "8px" : "0",
                    }}
                  >
                    {part.content ? (
                      <Streamdown
                        className="streamdown-content"
                        style={{
                          color: isUser ? "#ffffff" : "#000000",
                        }}
                      >
                        {part.content}
                      </Streamdown>
                    ) : null}
                  </div>
                );
              } else if (part.type === "tool_call") {
                return (
                  <div
                    key={idx}
                    style={{
                      fontSize: "12px",
                      opacity: 0.8,
                      marginTop: "8px",
                      marginBottom:
                        idx < message.parts!.length - 1 ? "8px" : "0",
                      paddingTop: "8px",
                      borderTop: `1px solid ${isUser ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.1)"}`,
                    }}
                  >
                    <div>
                      🔧 <strong>{part.tool}</strong>
                      {part.input && Object.keys(part.input).length > 0 && (
                        <span style={{ marginLeft: "4px" }}>
                          {part.input._streaming ? (
                            <span style={{ opacity: 0.7, fontStyle: "italic" }}>
                              (streaming: {part.input._partial_json || "..."})
                            </span>
                          ) : (
                            `(${JSON.stringify(part.input)})`
                          )}
                        </span>
                      )}
                    </div>
                    {part.result !== undefined && (
                      <div
                        style={{
                          marginTop: "8px",
                          padding: "8px",
                          backgroundColor: isUser
                            ? "rgba(255,255,255,0.1)"
                            : "rgba(0,0,0,0.05)",
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontFamily: "monospace",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          maxHeight: "300px",
                          overflowY: "auto",
                        }}
                      >
                        <div
                          style={{ marginBottom: "4px", fontWeight: "bold" }}
                        >
                          Result:
                        </div>
                        {typeof part.result === "string" ? (
                          part.result
                        ) : (
                          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                            {JSON.stringify(part.result, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            })}
          </div>
        ) : (
          // Fallback: render content first, then tool calls (old behavior)
          <>
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
                    {toolCall.input &&
                      Object.keys(toolCall.input).length > 0 && (
                        <span style={{ marginLeft: "4px" }}>
                          ({JSON.stringify(toolCall.input)})
                        </span>
                      )}
                  </div>
                ))}
              </div>
            )}
          </>
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
