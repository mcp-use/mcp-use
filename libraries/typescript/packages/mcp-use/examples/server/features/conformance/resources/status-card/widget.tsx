import { useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { z } from "zod";

const propSchema = z.object({
  status: z.string().describe("The system status"),
  details: z.string().describe("Detailed status information"),
  timestamp: z.string().describe("ISO timestamp of the status check"),
});

export const widgetMetadata: WidgetMetadata = {
  description:
    "Display system status card (demonstrates exposeAsTool: false pattern)",
  props: propSchema,
  exposeAsTool: false, // This widget will NOT be auto-registered as a tool
};

type StatusCardProps = z.infer<typeof propSchema>;

const StatusCard: React.FC = () => {
  const { props, isPending } = useWidget<StatusCardProps>();

  if (
    isPending ||
    !props ||
    !props.status ||
    !props.details ||
    !props.timestamp
  ) {
    return (
      <div
        style={{
          padding: "20px",
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
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
        <p style={{ marginTop: "12px", color: "#666" }}>Fetching status...</p>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  const statusColors = {
    operational: {
      bg: "#d4edda",
      border: "#28a745",
      text: "#155724",
      icon: "✓",
    },
    degraded: { bg: "#fff3cd", border: "#ffc107", text: "#856404", icon: "⚠" },
    down: { bg: "#f8d7da", border: "#dc3545", text: "#721c24", icon: "✗" },
  };

  const statusLower = props.status.toLowerCase();
  const colors =
    statusColors[statusLower as keyof typeof statusColors] ||
    statusColors.operational;

  const formatTimestamp = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          background: "white",
          border: `3px solid ${colors.border}`,
          borderRadius: "16px",
          padding: "24px",
          maxWidth: "500px",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              width: "60px",
              height: "60px",
              background: colors.bg,
              border: `2px solid ${colors.border}`,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
              flexShrink: 0,
            }}
          >
            {colors.icon}
          </div>
          <div style={{ flex: 1 }}>
            <h2
              style={{
                margin: "0 0 4px 0",
                color: colors.text,
                fontSize: "24px",
                fontWeight: "700",
                textTransform: "capitalize",
              }}
            >
              {props.status}
            </h2>
            <p
              style={{
                margin: 0,
                color: "#666",
                fontSize: "14px",
              }}
            >
              Status Check
            </p>
          </div>
        </div>

        <div
          style={{
            background: "#f8f9fa",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "12px",
          }}
        >
          <h3
            style={{
              margin: "0 0 8px 0",
              fontSize: "14px",
              fontWeight: "600",
              color: "#495057",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Details
          </h3>
          <p
            style={{
              margin: 0,
              color: "#212529",
              fontSize: "14px",
              lineHeight: "1.6",
            }}
          >
            {props.details}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "#6c757d",
            fontSize: "12px",
          }}
        >
          <span>🕐</span>
          <span>{formatTimestamp(props.timestamp)}</span>
        </div>
      </div>
    </div>
  );
};

export default StatusCard;
