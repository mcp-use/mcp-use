import type { ReactNode } from "react";

interface StatusCardProps {
  title: string;
  detail: string;
  logo?: ReactNode;
}

/** Card shared by the Next.js landing page and the MCP App view. */
export function StatusCard({ title, detail, logo }: StatusCardProps) {
  return (
    <article
      style={{
        border: "1px solid #d4d4d8",
        borderRadius: 16,
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.08)",
        maxWidth: 520,
        padding: 24,
      }}
    >
      <div style={{ float: "right" }}>{logo}</div>
      <p style={{ color: "#71717a", margin: "0 0 8px" }}>mcp-use view</p>
      <h2 style={{ margin: "0 0 8px" }}>{title}</h2>
      <p style={{ margin: 0 }}>{detail}</p>
    </article>
  );
}
