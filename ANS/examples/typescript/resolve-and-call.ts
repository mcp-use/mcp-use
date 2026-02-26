/**
 * ANS Example: Resolve an ANS ID and call the discovered agent (TypeScript).
 *
 * Demonstrates the caller side: resolving an ANS identifier to a live
 * endpoint, verifying trust, and making a call.
 *
 * Usage:
 *   npx tsx resolve-and-call.ts
 */

// ─── Types ─────────────────────────────────────────────────────────────────

interface ResolvedAgent {
  ansId: string;
  endpoint: string;
  transport: string[];
  trustScore: number;
  certificateValid: boolean;
  publicKey: string;
  status: "active" | "degraded" | "unreachable" | "expired";
  ttl: number;
}

interface AgentSummary {
  ansId: string;
  name: string;
  trustScore: number;
  tags: string[];
  endpoint: string;
}

// ─── Simulated registry responses ──────────────────────────────────────────

function simulateResolve(ansId: string): ResolvedAgent {
  // In production: await client.resolve(ansId)
  return {
    ansId,
    endpoint: "https://agents.acme-corp.com/web-researcher",
    transport: ["mcp", "http"],
    trustScore: 0.87,
    certificateValid: true,
    publicKey: "ed25519:MCowBQYDK2VwAyEA...",
    status: "active",
    ttl: 3600,
  };
}

function simulateSearch(opts: { tags: string[]; minTrust: number }): AgentSummary[] {
  // In production: await client.search(opts)
  return [
    {
      ansId: "search.acme-corp.web-researcher",
      name: "Web Researcher",
      trustScore: 0.87,
      tags: ["web", "search", "research"],
      endpoint: "https://agents.acme-corp.com/web-researcher",
    },
    {
      ansId: "search.public.wikipedia",
      name: "Wikipedia Agent",
      trustScore: 0.95,
      tags: ["web", "search", "knowledge"],
      endpoint: "https://public.registry.example.com/agents/wikipedia",
    },
  ].filter((a) => a.trustScore >= opts.minTrust && opts.tags.some((t) => a.tags.includes(t)));
}

// ─── Trust gate helper ─────────────────────────────────────────────────────

function assertTrusted(agent: ResolvedAgent, minTrust: number): void {
  if (!agent.certificateValid) {
    throw new Error(`Agent ${agent.ansId}: certificate is invalid or expired`);
  }
  if (agent.trustScore < minTrust) {
    throw new Error(
      `Agent ${agent.ansId}: trust score ${agent.trustScore.toFixed(2)} below minimum ${minTrust}`
    );
  }
  if (agent.status !== "active") {
    throw new Error(`Agent ${agent.ansId}: status is ${agent.status}`);
  }
}

// ─── Demos ─────────────────────────────────────────────────────────────────

async function demoResolveById() {
  console.log("=== Resolving by ANS ID ===");
  const ansId = "search.acme-corp.web-researcher";

  const agent = simulateResolve(ansId);
  console.log("ANS ID:      ", agent.ansId);
  console.log("Endpoint:    ", agent.endpoint);
  console.log("Transport:   ", agent.transport.join(", "));
  console.log("Trust score: ", agent.trustScore.toFixed(2));
  console.log("Cert valid:  ", agent.certificateValid);
  console.log("Status:      ", agent.status);
  console.log("Cache TTL:   ", agent.ttl + "s");
  console.log();

  assertTrusted(agent, 0.70);
  console.log("Trust check passed. Would call:", agent.endpoint);
  console.log();
}

async function demoDiscoverByCapability() {
  console.log("=== Discovering agents by capability ===");

  const agents = simulateSearch({ tags: ["web", "search"], minTrust: 0.8 });
  console.log(`Found ${agents.length} agents matching tags=['web','search'] with minTrust=0.8:`);

  for (const [i, agent] of agents.entries()) {
    console.log(`  [${i + 1}] ${agent.ansId}`);
    console.log(`       Name:  ${agent.name}`);
    console.log(`       Trust: ${agent.trustScore.toFixed(2)}`);
    console.log(`       Tags:  ${agent.tags.join(", ")}`);
  }
  console.log();

  if (agents.length > 0) {
    const best = agents.reduce((a, b) => (a.trustScore > b.trustScore ? a : b));
    console.log(`Selected highest-trust agent: ${best.ansId} (score: ${best.trustScore.toFixed(2)})`);
    console.log();
  }
}

async function demoMCPAgentIntegration() {
  console.log("=== MCPAgent + ANS Integration (pseudo-code) ===");
  console.log(`
  import { MCPAgent } from 'mcp-use/agents';
  import { ANSClient } from 'mcp-use/ans';
  import Anthropic from '@anthropic-ai/sdk';

  const client = new ANSClient({ registry: 'https://registry.ans.example.com' });

  const agent = new MCPAgent({
    llm: new Anthropic(),
    ansClient: client,
    ansMinTrust: 0.75,
  });

  // MCPAgent resolves ANS IDs transparently when the LLM references them
  const response = await agent.run(
    "Use search.public.web-search to find recent news about MCP protocol adoption."
  );
  console.log(response);
  `);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  await demoResolveById();
  await demoDiscoverByCapability();
  await demoMCPAgentIntegration();
}

main().catch(console.error);
