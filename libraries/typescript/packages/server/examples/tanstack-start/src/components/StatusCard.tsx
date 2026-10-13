import type { ReactNode } from "react";

/** Browser-safe component shared by the Start page and standalone MCP view. */
export function StatusCard({
  title,
  detail,
  logo,
}: {
  title: string;
  detail: string;
  logo?: ReactNode;
}) {
  return (
    <article
      style={{
        border: "1px solid #d4d4d8",
        borderRadius: 16,
        padding: 24,
        maxWidth: 520,
      }}
    >
      <div style={{ float: "right" }}>{logo}</div>
      <p style={{ color: "#71717a" }}>mcp-use · TanStack Start</p>
      <h2>{title}</h2>
      <p>{detail}</p>
    </article>
  );
}
