import { useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { z } from "zod";

const propSchema = z.object({
  title: z.string().describe("The title of the information"),
  message: z.string().describe("The message content"),
  level: z
    .enum(["info", "success", "warning"])
    .optional()
    .default("info")
    .describe("The information level"),
});

export const widgetMetadata: WidgetMetadata = {
  description:
    "Display information with title and message (demonstrates subfolder auto-exposed pattern)",
  props: propSchema,
  // exposeAsTool: true is the default, so this widget will be auto-registered as a tool
};

type DisplayInfoProps = z.infer<typeof propSchema>;

const DisplayInfo: React.FC = () => {
  const { props, isPending } = useWidget<DisplayInfoProps>();

  if (isPending || !props || !props.title || !props.message) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <div
          style={{
            display: "inline-block",
            width: "40px",
            height: "40px",
            border: "4px solid #f3f3f3",
            borderTop: "4px solid #3498db",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
          }}
        />
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  const levelColors = {
    info: { bg: "#e3f2fd", border: "#2196f3", text: "#1565c0", icon: "ℹ️" },
    success: { bg: "#e8f5e9", border: "#4caf50", text: "#2e7d32", icon: "✓" },
    warning: {
      bg: "#fff3e0",
      border: "#ff9800",
      text: "#e65100",
      icon: "⚠",
    },
  };

  const level = props.level || "info";
  const colors = levelColors[level];

  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          background: colors.bg,
          border: `2px solid ${colors.border}`,
          borderRadius: "12px",
          padding: "20px",
          maxWidth: "500px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <div
            style={{
              fontSize: "24px",
              flexShrink: 0,
            }}
          >
            {colors.icon}
          </div>
          <div style={{ flex: 1 }}>
            <h3
              style={{
                margin: "0 0 8px 0",
                color: colors.text,
                fontSize: "18px",
                fontWeight: "600",
              }}
            >
              {props.title}
            </h3>
            <p
              style={{
                margin: 0,
                color: colors.text,
                fontSize: "14px",
                lineHeight: "1.5",
                opacity: 0.9,
              }}
            >
              {props.message}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DisplayInfo;
