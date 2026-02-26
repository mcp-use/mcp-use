# ANS Protocol Specification

**Agent Name System — Open Federated Protocol for Agent Discovery and Trust**

Version: `0.1.0-draft`
Status: `DRAFT — Pre-RFC`
License: `Apache 2.0`
Authors: mcp-use contributors

---

## Abstract

ANS (Agent Name System) is an open, federated protocol for agent identity, discovery, and trust. It solves a specific gap in the current MCP ecosystem: while MCP standardizes *how* agents call tools, no standard exists for *finding* other agents, *verifying* their capabilities, or *trusting* them across organizational boundaries.

ANS is to agent-to-agent coordination what DNS is to domain resolution and SMTP is to email: a decentralized, open infrastructure layer that nobody owns but everyone can use.

---

## 1. Problem Statement

### 1.1 The Current Gap

The agentic AI ecosystem in 2025-2026 consists of:

- **Tool-calling standards**: MCP (Model Context Protocol) — solves agent↔tool communication
- **Orchestration frameworks**: LangGraph, CrewAI, AutoGPT — solve *local* multi-agent coordination
- **Missing**: A standard for *cross-vendor, cross-organization* agent discovery and trust

An agent built on LangGraph cannot natively find, trust, or delegate to an agent built on CrewAI without custom integration code. An enterprise cannot verify that the agent it is calling actually is who it claims to be, or that it can actually do what it claims.

This creates:
1. Reinvented discovery logic in every system
2. No interoperability between agent frameworks
3. No trust primitives for agent-to-agent authorization
4. No capability introspection standard

### 1.2 What ANS Is Not

ANS does **not** replace:
- MCP (tool-calling protocol) — ANS works *above* MCP
- Orchestration frameworks — ANS provides *discovery*, not execution coordination
- LLM inference APIs — ANS is transport-agnostic
- Application-layer auth (OAuth, API keys) — ANS adds an identity layer *on top*

---

## 2. Core Concepts

### 2.1 Agent Identifier

Every registered agent has a globally unique identifier in hierarchical dot-notation:

```
<service>.<namespace>.<agent-name>
```

Examples:
```
search.acme-corp.web-researcher
github.acme-corp.pr-reviewer
assistant.public.notion-sync
compute.anthropic.claude-agent
```

The identifier follows the same logic as a domain name:
- **service**: the capability category (search, compute, data, assistant, etc.)
- **namespace**: the organization or user scope
- **agent-name**: the specific agent instance

Identifiers are case-insensitive, lowercase, alphanumeric + hyphens.

### 2.2 Capability Schema

Every agent publishes a signed **Capability Manifest** — a JSON document describing what the agent can do:

```json
{
  "ans_version": "0.1",
  "id": "search.acme-corp.web-researcher",
  "name": "Web Researcher",
  "description": "Searches the web and synthesizes information into structured reports",
  "version": "1.2.0",
  "endpoint": "https://agents.acme-corp.com/web-researcher",
  "transport": ["http", "mcp"],
  "capabilities": [
    {
      "name": "search",
      "description": "Search the web for information on a topic",
      "input_schema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "max_results": { "type": "integer", "default": 10 }
        },
        "required": ["query"]
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "results": { "type": "array" },
          "summary": { "type": "string" }
        }
      }
    }
  ],
  "constraints": {
    "rate_limit": "100/hour",
    "max_context_tokens": 32000,
    "supported_languages": ["en", "it", "fr"]
  },
  "trust": {
    "public_key": "ed25519:AAAA...base64...",
    "certificate": "https://ans.registry.example.com/cert/search.acme-corp.web-researcher",
    "signature": "base64_signature_of_manifest_hash"
  },
  "meta": {
    "created_at": "2025-01-15T10:00:00Z",
    "updated_at": "2026-02-01T08:30:00Z",
    "tags": ["web", "search", "research"],
    "license": "MIT",
    "contact": "agents@acme-corp.com"
  }
}
```

The manifest is signed with the agent's private key. Any consumer can verify it using the `public_key` field. The registry never has access to the private key.

### 2.3 Registry Node

An ANS Registry is a server that:
1. Stores agent capability manifests
2. Resolves ANS identifiers to endpoints
3. Issues trust certificates for registered agents
4. Federates with other registry nodes

Registry nodes are **federated**: they can synchronize known agents across a network of nodes, similar to how DNS root servers propagate zone information. No single node is authoritative for the entire namespace.

### 2.4 Trust Score

The **Trust Score** is a numeric value (0.0–1.0) assigned to each agent based on verifiable signals:

| Signal | Weight | Description |
|--------|--------|-------------|
| `task_completion_rate` | 30% | Fraction of delegated tasks successfully completed |
| `latency_accuracy` | 15% | Declared latency vs. measured latency |
| `uptime` | 20% | Historical availability |
| `incident_count` | 20% | Security incidents, errors, SLA violations |
| `certificate_age` | 15% | Age of the trust certificate (older = more stable) |

Trust scores are computed by the registry and optionally enriched by a **Trust Oracle** service.

---

## 3. Protocol Operations

### 3.1 Registration

An agent registers by posting its signed manifest to a registry node:

```
POST /v1/agents/register
Content-Type: application/json

{
  "manifest": { ...capability manifest... },
  "proof": {
    "type": "ed25519",
    "signature": "base64..."
  }
}
```

Response:
```json
{
  "ans_id": "search.acme-corp.web-researcher",
  "certificate": "https://registry.example.com/cert/...",
  "trust_score": 0.0,
  "registered_at": "2026-02-26T10:00:00Z",
  "ttl": 86400
}
```

### 3.2 Resolution

Resolve an ANS ID to a live endpoint:

```
GET /v1/agents/resolve/search.acme-corp.web-researcher
```

Response:
```json
{
  "ans_id": "search.acme-corp.web-researcher",
  "endpoint": "https://agents.acme-corp.com/web-researcher",
  "transport": ["http", "mcp"],
  "trust_score": 0.87,
  "certificate_valid": true,
  "ttl": 3600
}
```

### 3.3 Discovery (Search)

Find agents by capability tags, namespace, or natural language:

```
GET /v1/agents/search?tags=web,search&min_trust=0.7&limit=10
```

```
GET /v1/agents/search?q=agent+that+can+summarize+GitHub+PRs
```

Response:
```json
{
  "agents": [
    {
      "ans_id": "search.acme-corp.web-researcher",
      "name": "Web Researcher",
      "trust_score": 0.87,
      "tags": ["web", "search"],
      "endpoint": "https://agents.acme-corp.com/web-researcher"
    }
  ],
  "total": 1
}
```

### 3.4 Heartbeat (Health Reporting)

Registered agents periodically confirm they are alive:

```
POST /v1/agents/search.acme-corp.web-researcher/heartbeat
Authorization: Bearer <agent_token>

{
  "status": "healthy",
  "latency_p50_ms": 120,
  "latency_p99_ms": 800
}
```

The registry uses heartbeat data to update trust scores and mark agents as unreachable.

### 3.5 Federation (Node Sync)

Registry nodes share their agent lists:

```
GET /v1/federation/agents?since=2026-02-26T00:00:00Z
```

Returns a diff of agents registered or updated since the given timestamp. This allows federated nodes to maintain eventually-consistent views of the entire network.

---

## 4. Trust Model

### 4.1 Threat Model

ANS is designed to resist:

- **Impersonation**: Agent B claims to be agent A
- **Capability spoofing**: Agent declares capabilities it cannot fulfill
- **Registry poisoning**: A malicious node injects fraudulent agents
- **Replay attacks**: Old manifests used to impersonate rotated keys

ANS does **not** try to protect against:
- Malicious agents that are honestly registered (reputation handles this)
- Content-level attacks on agent outputs (caller's responsibility)
- Zero-day exploits in agent implementations (out of scope)

### 4.2 Cryptographic Identity

Each agent generates an Ed25519 keypair:
- **Private key**: Held by the agent, never shared
- **Public key**: Published in the manifest and to the registry

The manifest hash is signed with the private key. Any verifier with the public key can confirm the manifest is authentic and unmodified.

Key rotation: agents may rotate keys by submitting a new manifest signed with the old key plus the new key. The registry validates the chain.

### 4.3 Certificate Issuance

When a registry node issues a certificate, it attests:
1. The ANS ID is unique in the federated namespace
2. The public key in the manifest was presented at registration time
3. The registration occurred at the stated timestamp

Certificates use JWT format with Ed25519 signing:

```json
{
  "iss": "https://registry.example.com",
  "sub": "search.acme-corp.web-researcher",
  "iat": 1740560000,
  "exp": 1740646400,
  "public_key": "ed25519:AAAA...",
  "ans_version": "0.1"
}
```

### 4.4 Verification Flow

When agent A wants to call agent B:

```
1. A queries registry: resolve("search.acme-corp.web-researcher")
2. Registry returns endpoint + certificate + public_key
3. A verifies certificate signature (issued by known registry)
4. A sends request to B's endpoint
5. B signs its response with its private key
6. A verifies response signature with B's public key
7. Trust is established without the registry being in the data path
```

The registry is only consulted for discovery. After that, the two agents communicate directly. This is critical for privacy and scalability.

---

## 5. Federation Model

### 5.1 Federated Namespace

The ANS namespace is federated by the first segment (`service`):

- No single node owns the entire namespace
- Each node can be authoritative for a subset of namespaces
- Nodes can mirror any public namespace from other nodes
- Private namespaces can exist on private nodes

Example topology:
```
Node A (public.registry.example.com)
  - Authoritative for: public.*, oss.*
  - Mirrors: acme-corp.*, startup.*

Node B (private.acme-corp.internal)
  - Authoritative for: acme-corp.*
  - Private; not federated publicly

Node C (eu.registry.example.com)
  - Authoritative for: eu.*
  - Mirrors: public.*, acme-corp.*
```

### 5.2 Conflict Resolution

When two nodes have conflicting manifests for the same ANS ID:
1. Prefer the manifest from the authoritative node for that namespace
2. If authority is unclear, prefer the most recent manifest
3. If manifests conflict on public key, flag as disputed and don't serve

### 5.3 Federation Wire Protocol

Nodes communicate over HTTPS with mutual TLS. The sync endpoint follows a pull model: each node periodically fetches updates from its peers.

```
GET /v1/federation/agents
  ?since=<ISO8601>
  &namespaces=public,oss
```

---

## 6. Transport Compatibility

ANS is transport-agnostic. The `transport` field in a manifest declares which protocols an agent supports:

| Transport | Description |
|-----------|-------------|
| `http` | Standard HTTP REST calls |
| `mcp` | Model Context Protocol (via stdio or SSE) |
| `grpc` | gRPC binary protocol |
| `ws` | WebSocket streaming |

Callers select the transport they support. If multiple are available, prefer MCP for agents that are already in an MCP-native environment.

---

## 7. Versioning

### 7.1 Protocol Versioning

The protocol version is declared in manifests as `ans_version`. The registry enforces compatibility:
- Minor version bumps: backward compatible
- Major version bumps: registry maintains both versions

### 7.2 Agent Versioning

Agent manifests include a `version` field following semver. When an agent updates its capabilities:
- Patch version: bug fixes only, same capabilities
- Minor version: new capabilities added
- Major version: breaking changes; registry flags existing callers

---

## 8. Privacy and Data Minimization

The registry stores **only**:
- ANS identifiers
- Capability schemas
- Public keys
- Endpoint URLs
- Trust scores

The registry **never** stores:
- Agent request/response traffic
- User data processed by agents
- Private keys
- Internal agent configuration

This is by design: the registry must be safe to run in federated, potentially untrusted nodes.

---

## 9. Error Codes

| Code | Meaning |
|------|---------|
| `ANS_NOT_FOUND` | Agent ID not registered in any known node |
| `ANS_CERT_EXPIRED` | Agent certificate has expired; must re-register |
| `ANS_CERT_INVALID` | Certificate signature verification failed |
| `ANS_CONFLICT` | ANS ID already registered with a different key |
| `ANS_RATE_LIMITED` | Query rate limit exceeded |
| `ANS_FEDERATION_ERROR` | Federated node sync failure |

---

## 10. Relationship to MCP

ANS and MCP are complementary layers:

```
┌─────────────────────────────────────────┐
│           Application / Agent Logic      │
├─────────────────────────────────────────┤
│  ANS Layer: Discovery, Identity, Trust  │  ← This spec
├─────────────────────────────────────────┤
│  MCP Layer: Tool Calling Protocol       │  ← MCP spec
├─────────────────────────────────────────┤
│  Transport: HTTP / SSE / stdio          │
└─────────────────────────────────────────┘
```

A typical flow:
1. Agent A uses **ANS** to discover and verify Agent B
2. Agent A connects to Agent B's MCP endpoint (from ANS manifest)
3. Agent A uses **MCP** to call tools exposed by Agent B
4. Agent B's response is verified against its ANS public key

ANS provides the *who* and *where*. MCP provides the *what* and *how*.

---

## Appendix A: Reference Schema (JSON Schema Draft 7)

See `schemas/agent-manifest.json` for the full JSON Schema definition.

## Appendix B: SDK Integration

See `examples/` for Python and TypeScript SDK integration examples.

## Appendix C: Changelog

| Version | Date | Notes |
|---------|------|-------|
| 0.1.0-draft | 2026-02-26 | Initial draft |
