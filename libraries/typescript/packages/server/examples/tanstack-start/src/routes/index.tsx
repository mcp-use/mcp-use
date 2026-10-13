import { createFileRoute } from "@tanstack/react-router";
import { StatusCard } from "@/components/StatusCard";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "64px auto", padding: 24 }}>
      <h1>TanStack Start + mcp-use</h1>
      <p>
        One application serves this page and the MCP endpoint at{" "}
        <code>/api/mcp</code>.
      </p>
      <StatusCard
        title="MCP view ready"
        detail="This component is shared with the MCP App view."
      />
      <p>
        Connect an MCP client and call <code>greet</code> or{" "}
        <code>show-status-card</code>.
      </p>
    </main>
  );
}
