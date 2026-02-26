"""
ANS Example: Resolve an ANS ID and call the discovered agent.

This demonstrates the caller side of ANS: resolving a known ANS identifier
to a live endpoint, verifying the certificate, and making a call.

Usage:
    python resolve_and_call.py
"""

import asyncio
import json
from dataclasses import dataclass
from typing import Any


# ─── Simulated resolution result ──────────────────────────────────────────

@dataclass
class ResolvedAgent:
    ans_id: str
    endpoint: str
    transport: list[str]
    trust_score: float
    certificate_valid: bool
    public_key: str
    status: str
    ttl: int


def simulate_resolution(ans_id: str) -> ResolvedAgent:
    """Simulates what ANSClient.resolve() would return from the registry."""
    # In production: HTTP GET /v1/agents/resolve/{ans_id}
    return ResolvedAgent(
        ans_id=ans_id,
        endpoint="https://agents.acme-corp.com/web-researcher",
        transport=["mcp", "http"],
        trust_score=0.87,
        certificate_valid=True,
        public_key="ed25519:MCowBQYDK2VwAyEA...",
        status="active",
        ttl=3600,
    )


# ─── Simulated search ─────────────────────────────────────────────────────

@dataclass
class AgentSummary:
    ans_id: str
    name: str
    trust_score: float
    tags: list[str]
    endpoint: str


def simulate_search(tags: list[str], min_trust: float) -> list[AgentSummary]:
    """Simulates what ANSClient.search() would return."""
    # In production: HTTP GET /v1/agents/search?tags=...&min_trust=...
    return [
        AgentSummary(
            ans_id="search.acme-corp.web-researcher",
            name="Web Researcher",
            trust_score=0.87,
            tags=["web", "search", "research"],
            endpoint="https://agents.acme-corp.com/web-researcher",
        ),
        AgentSummary(
            ans_id="search.public.wikipedia",
            name="Wikipedia Agent",
            trust_score=0.95,
            tags=["web", "search", "knowledge"],
            endpoint="https://public.registry.example.com/agents/wikipedia",
        ),
    ]


# ─── Main demo ────────────────────────────────────────────────────────────

async def demo_resolve_by_id():
    """Resolve a known ANS ID directly."""
    print("=== Resolving by ANS ID ===")
    ans_id = "search.acme-corp.web-researcher"

    # This is what the real API call looks like:
    # client = ANSClient(registry="https://registry.ans.example.com")
    # agent = await client.resolve(ans_id)

    agent = simulate_resolution(ans_id)

    print(f"ANS ID:       {agent.ans_id}")
    print(f"Endpoint:     {agent.endpoint}")
    print(f"Transport:    {agent.transport}")
    print(f"Trust score:  {agent.trust_score:.2f}")
    print(f"Cert valid:   {agent.certificate_valid}")
    print(f"Status:       {agent.status}")
    print(f"TTL:          {agent.ttl}s")
    print()

    # Trust gate: caller decides minimum acceptable trust
    MIN_TRUST = 0.70
    if agent.trust_score < MIN_TRUST:
        raise ValueError(f"Agent trust score {agent.trust_score:.2f} below minimum {MIN_TRUST}")

    if not agent.certificate_valid:
        raise ValueError("Agent certificate is invalid or expired")

    print(f"Trust check passed. Calling {agent.endpoint}...")
    # In production: make HTTP/MCP call to agent.endpoint
    # response = await http_client.post(agent.endpoint + "/search", json={"query": "MCP protocol"})


async def demo_discover_by_capability():
    """Discover agents by capability tags and trust threshold."""
    print("=== Discovering agents by capability ===")

    # Real API call:
    # client = ANSClient(registry="https://registry.ans.example.com")
    # agents = await client.search(tags=["web", "search"], min_trust=0.8)

    agents = simulate_search(tags=["web", "search"], min_trust=0.8)

    print(f"Found {len(agents)} agents matching tags=['web','search'] with min_trust=0.8:")
    for i, agent in enumerate(agents):
        print(f"  [{i+1}] {agent.ans_id}")
        print(f"       Name:  {agent.name}")
        print(f"       Trust: {agent.trust_score:.2f}")
        print(f"       Tags:  {', '.join(agent.tags)}")
    print()

    if agents:
        # Pick the highest-trust agent
        best = max(agents, key=lambda a: a.trust_score)
        print(f"Selected highest-trust agent: {best.ans_id} (score: {best.trust_score:.2f})")


async def demo_mcpagent_integration():
    """Show how MCPAgent would use ANS for discovery (pseudo-code)."""
    print("=== MCPAgent + ANS Integration (pseudo-code) ===")
    print("""
    from mcp_use import MCPAgent
    from mcp_use.ans import ANSClient
    from langchain_anthropic import ChatAnthropic

    # Configure ANS-aware MCPAgent
    agent = MCPAgent(
        llm=ChatAnthropic(model="claude-sonnet-4-6"),
        ans_client=ANSClient(registry="https://registry.ans.example.com"),
        ans_min_trust=0.75,  # Reject agents below this trust threshold
    )

    # The agent can now reference other agents by ANS ID in its system prompt
    # or tool calls. ANS resolution happens transparently.
    response = await agent.run(
        "Find information about the MCP protocol using search.public.web-search"
        " and summarize the results."
    )
    print(response)
    """)


async def main():
    await demo_resolve_by_id()
    await demo_discover_by_capability()
    await demo_mcpagent_integration()


if __name__ == "__main__":
    asyncio.run(main())
