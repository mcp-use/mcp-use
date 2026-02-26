# ANS — Agent Name System

**An open, federated protocol for agent identity, discovery, and trust.**

---

## What is ANS?

ANS (Agent Name System) is the missing infrastructure layer between MCP (tool-calling) and the emerging multi-agent economy. Where MCP standardizes *how* agents call tools, ANS standardizes *how agents find, identify, and trust each other* across organizational boundaries.

```
┌─────────────────────────────────────────┐
│       Application / Agent Logic         │
├─────────────────────────────────────────┤
│  ANS Layer: Discovery, Identity, Trust  │  ← This folder
├─────────────────────────────────────────┤
│  MCP Layer: Tool Calling Protocol       │
├─────────────────────────────────────────┤
│  Transport: HTTP / SSE / stdio          │
└─────────────────────────────────────────┘
```

ANS is the DNS of the agent web: no single owner, federated nodes, open protocol, commercial services built on top.

---

## Documents in This Folder

| Document | Description |
|----------|-------------|
| [PROTOCOL.md](./PROTOCOL.md) | Full protocol specification: identifiers, capability manifests, API operations, trust model, federation |
| [STRATEGY.md](./STRATEGY.md) | Strategic vision: why ANS, timing, go-to-market, competitive positioning, monetization |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Technical architecture: data model, registry design, SDK API, security, implementation roadmap |

## Schemas

| Schema | Description |
|--------|-------------|
| [schemas/agent-manifest.json](./schemas/agent-manifest.json) | JSON Schema for agent capability manifests |
| [schemas/heartbeat.json](./schemas/heartbeat.json) | JSON Schema for agent health heartbeats |
| [schemas/resolution.json](./schemas/resolution.json) | JSON Schema for registry resolution responses |

## Examples

| Example | Language | Description |
|---------|----------|-------------|
| [examples/python/register_agent.py](./examples/python/register_agent.py) | Python | Register an agent and generate a manifest |
| [examples/python/resolve_and_call.py](./examples/python/resolve_and_call.py) | Python | Resolve an ANS ID and call the discovered agent |
| [examples/typescript/register-agent.ts](./examples/typescript/register-agent.ts) | TypeScript | Register an agent (TypeScript) |
| [examples/typescript/resolve-and-call.ts](./examples/typescript/resolve-and-call.ts) | TypeScript | Resolve and call (TypeScript) |

---

## Quick Concept Summary

### Agent Identifier

Every agent gets a globally unique ID in hierarchical dot-notation:

```
<service>.<namespace>.<agent-name>

Examples:
  search.acme-corp.web-researcher
  assistant.public.notion-sync
  compute.my-startup.code-executor
```

### Capability Manifest

Each agent publishes a signed JSON document describing what it does:

```json
{
  "ans_version": "0.1",
  "id": "search.acme-corp.web-researcher",
  "name": "Web Researcher",
  "description": "Searches and synthesizes web content",
  "endpoint": "https://agents.acme-corp.com/web-researcher",
  "transport": ["mcp", "http"],
  "capabilities": [
    {
      "name": "search",
      "description": "Search the web for information on a topic",
      "input_schema": { "type": "object", "required": ["query"], ... }
    }
  ],
  "trust": {
    "public_key": "ed25519:...",
    "signature": "..."
  }
}
```

### The Registry

A federated network of registry nodes that:
1. Store capability manifests
2. Resolve ANS IDs to endpoints
3. Issue trust certificates
4. Compute reputation scores from heartbeat data
5. Sync with peer nodes (federation)

### Integration with mcp-use

The planned SDK integration (in progress):

```python
# Python
from mcp_use.ans import ANSClient

client = ANSClient(registry="https://registry.ans.example.com")

# Resolve
agent = await client.resolve("search.acme-corp.web-researcher")
print(agent.endpoint, agent.trust_score)

# Discover
agents = await client.search(tags=["web", "search"], min_trust=0.8)

# Register your agent
result = await client.register(manifest, keypair=keypair)
```

```typescript
// TypeScript
import { ANSClient } from 'mcp-use/ans';

const client = new ANSClient({ registry: 'https://registry.ans.example.com' });

const agent = await client.resolve('search.acme-corp.web-researcher');
const agents = await client.search({ tags: ['web', 'search'], minTrust: 0.8 });
```

---

## Status

| Component | Status |
|-----------|--------|
| Protocol specification | Draft (v0.1) |
| JSON Schemas | Draft |
| Python SDK (`mcp_use.ans`) | Planned |
| TypeScript SDK (`mcp-use/ans`) | Planned |
| Reference registry server | Planned |
| Hosted registry | Future |
| Trust Oracle | Future |

---

## Background

This protocol emerges from the observation that MCP solved tool-calling but left agent-to-agent discovery unsolved. The timing is optimal: MCP has achieved ecosystem adoption, the multi-agent pattern is becoming standard, but no open discovery layer exists yet.

See [STRATEGY.md](./STRATEGY.md) for the full analysis of why now, why open/federated, and how to build toward adoption.

See [PROTOCOL.md](./PROTOCOL.md) for the complete technical specification.

---

*License: Protocol specification is Apache 2.0. Reference implementation will be MIT.*
