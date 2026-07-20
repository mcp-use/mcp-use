import { StatusCard } from "@/components/StatusCard";
import { getProjectStatus } from "@/lib/project-service";

export default async function Home() {
  const status = await getProjectStatus("Next.js landing page");

  return (
    <main style={{ margin: "48px auto", maxWidth: 720, padding: 24 }}>
      <h1>Next.js + standalone mcp-use</h1>
      <p>The website and MCP server run as separate processes.</p>
      <StatusCard title={status.title} detail={status.detail} />
    </main>
  );
}
