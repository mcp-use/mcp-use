import { StatusCard } from "../components/StatusCard";

/** The MCP view uses the same StatusCard web component as this landing page. */
export default function Home() {
  return (
    <main>
      <h1>Next.js + mcp-use</h1>
      <p>Connect an MCP client to /api/mcp.</p>
      <StatusCard
        title="MCP view ready"
        detail="This shared component is also rendered in the MCP App view."
        logo={
          <img
            src="/next-mark.svg"
            width="48"
            height="48"
            alt="Next.js example mark"
          />
        }
      />
    </main>
  );
}
