import type { KeyboardEvent } from "react";
import React, { useState } from "react";

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
}

export function MessageInput({
  onSend,
  disabled,
  isStreaming,
  onStop,
}: MessageInputProps) {
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput("");
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        padding: "16px",
        backgroundColor: "#ffffff",
        borderTop: "1px solid #e0e0e0",
        gap: "8px",
      }}
    >
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={handleKeyPress}
        placeholder="Describe the MCP server you want to build..."
        disabled={disabled}
        style={{
          flex: 1,
          padding: "12px",
          borderRadius: "8px",
          border: "1px solid #e0e0e0",
          fontSize: "14px",
          fontFamily: "inherit",
          resize: "none",
          minHeight: "44px",
          maxHeight: "120px",
        }}
        rows={1}
      />
      {isStreaming ? (
        <button
          onClick={onStop}
          style={{
            padding: "12px 24px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: "#d32f2f",
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: "500",
            cursor: "pointer",
          }}
        >
          ⏹ Stop
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          style={{
            padding: "12px 24px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: disabled || !input.trim() ? "#ccc" : "#007bff",
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: "500",
            cursor: disabled || !input.trim() ? "not-allowed" : "pointer",
          }}
        >
          Send
        </button>
      )}
    </div>
  );
}
