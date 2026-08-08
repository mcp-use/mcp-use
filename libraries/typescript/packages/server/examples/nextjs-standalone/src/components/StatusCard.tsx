export interface StatusCardProps {
  title: string;
  detail: string;
}

/** Browser-safe component shared by the Next.js page and MCP App view. */
export function StatusCard({ title, detail }: StatusCardProps) {
  return (
    <article
      style={{
        border: "1px solid #d4d4d8",
        borderRadius: 16,
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.08)",
        padding: 24,
      }}
    >
      <p style={{ color: "#71717a", margin: "0 0 8px" }}>shared component</p>
      <h2 style={{ margin: "0 0 8px" }}>{title}</h2>
      <p style={{ margin: 0 }}>{detail}</p>
    </article>
  );
}
