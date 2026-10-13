import { useToolContext } from "mcp-use/react";

const card = {
  fontFamily: "system-ui, sans-serif",
  padding: "12px 16px",
  border: "1px solid #d0d5dd",
  borderRadius: 8,
} as const;

/** Shows what the server saw when `public_card` ran. */
export default function View() {
  const view = useToolContext<"public_card">();
  if (view.status === "pending") return <p style={card}>Loading…</p>;
  if (view.status === "error") {
    return (
      <p style={card} role="alert">
        {view.error.message}
      </p>
    );
  }
  const { title, caller, scopes } = view.toolOutput;
  return (
    <div style={card}>
      <strong>{title}</strong>
      <p>Caller: {caller}</p>
      <p>Token scopes: {scopes.length > 0 ? scopes.join(" ") : "none"}</p>
    </div>
  );
}
