import { Card } from "@/components/card";
import { getGreeting } from "@/lib/server-data";

export default async function Page() {
  const greeting = await getGreeting("Next.js");
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Next.js + drop-in MCP</h1>
      <Card title="From @/lib/server-data">{greeting}</Card>
      <p>
        MCP server runs separately via <code>pnpm dev</code> at{" "}
        <code>http://localhost:3000/mcp</code>.
      </p>
    </main>
  );
}
