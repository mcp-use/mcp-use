# ANS Reference Architecture

**Technical Design and Implementation Guide**

---

## Overview

This document describes the technical architecture of the ANS (Agent Name System) reference implementation, designed to be built on top of the mcp-use ecosystem.

---

## 1. System Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ANS Ecosystem                                │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │  Agent SDK   │    │  Registry    │    │   Trust Oracle       │  │
│  │  (py/ts)     │◄──►│  Node        │◄──►│   (Hosted Service)   │  │
│  └──────┬───────┘    └──────┬───────┘    └──────────────────────┘  │
│         │                   │                                        │
│         │    ┌──────────────┘                                        │
│         │    │              Federation                               │
│         │    │    ┌─────────────────────────┐                       │
│         │    └───►│  Other Registry Nodes   │                       │
│         │         └─────────────────────────┘                       │
│         │                                                            │
│  ┌──────▼───────────────────────────────────────┐                  │
│  │           Registered Agents                   │                  │
│  │  agent-a.acme.researcher                     │                  │
│  │  agent-b.acme.pr-reviewer                    │                  │
│  │  search.public.web-search                    │                  │
│  └──────────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.1 ANS SDK

Language-native client libraries that:
- Generate and manage Ed25519 keypairs for agents
- Sign capability manifests
- Register agents with registry nodes
- Resolve ANS IDs to endpoints
- Verify cryptographic signatures on responses

**Python**: `mcp_use.ans` module (built on existing mcp-use Python library)
**TypeScript**: `mcp-use/ans` module (built on existing mcp-use TS library)

### 1.2 Registry Node

A standalone server (reference implementation, deployable anywhere) that:
- Stores capability manifests in a database
- Validates cryptographic signatures on registration
- Serves resolution and search queries
- Issues trust certificates (JWTs signed with the node's key)
- Performs federation sync with peer nodes
- Computes and updates trust scores based on heartbeats

### 1.3 Trust Oracle

A centralized hosted service that:
- Aggregates trust signals across all federated nodes
- Provides enriched trust scores beyond basic heartbeat data
- Issues high-assurance "ANS Certified" certificates
- Maintains compliance-grade audit logs
- Offers API for trust score queries

The Trust Oracle is **optional** — the base protocol works without it.

---

## 2. Data Model

### 2.1 Agent Record (Registry Storage)

```python
@dataclass
class AgentRecord:
    # Identity
    ans_id: str                    # "search.acme-corp.web-researcher"
    namespace: str                 # "acme-corp"
    service: str                   # "search"
    name: str                      # "web-researcher"

    # Cryptographic identity
    public_key: str                # "ed25519:AAAA..."
    manifest_hash: str             # SHA-256 of canonical manifest JSON
    manifest_signature: str        # Ed25519 signature of manifest_hash

    # Capability data
    manifest: dict                 # Full capability manifest
    endpoint: str                  # "https://agents.acme-corp.com/web-researcher"
    transports: list[str]          # ["http", "mcp"]
    tags: list[str]                # ["web", "search"]

    # Trust data
    trust_score: float             # 0.0-1.0
    trust_score_updated_at: datetime
    certificate: str               # JWT certificate

    # Lifecycle
    registered_at: datetime
    updated_at: datetime
    last_heartbeat_at: datetime | None
    ttl_seconds: int               # Default 86400
    status: Literal["active", "unreachable", "expired", "suspended"]

    # Federation
    authoritative_node: str        # Node that first registered this agent
    federation_version: int        # Monotonically increasing for conflict resolution
```

### 2.2 Trust Score Components

```python
@dataclass
class TrustScoreBreakdown:
    overall: float                 # Weighted composite

    # Component scores (0.0-1.0)
    task_completion_rate: float    # From heartbeat reports
    latency_accuracy: float        # Declared vs measured
    uptime: float                  # % time reachable
    incident_rate: float           # Inverse of incident count
    certificate_age: float         # Normalized age score

    # Metadata
    computed_at: datetime
    based_on_samples: int
    confidence: float              # How confident the score is (needs data)
```

### 2.3 Federation State

```python
@dataclass
class FederationPeer:
    node_id: str
    url: str
    public_key: str
    last_sync_at: datetime | None
    authoritative_namespaces: list[str]
    sync_interval_seconds: int = 300
```

---

## 3. Registry Node Architecture

### 3.1 API Layer

```
HTTP Server (FastAPI / Express)
├── POST   /v1/agents/register
├── GET    /v1/agents/resolve/{ans_id}
├── GET    /v1/agents/search
├── POST   /v1/agents/{ans_id}/heartbeat
├── GET    /v1/agents/{ans_id}/manifest
├── DELETE /v1/agents/{ans_id}           (agent auth required)
├── GET    /v1/federation/agents          (federation sync)
├── POST   /v1/federation/announce        (new node announces itself)
└── GET    /v1/health
```

### 3.2 Storage Layer

**SQLite** (default, single-node):
```sql
CREATE TABLE agents (
    ans_id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    service TEXT NOT NULL,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    manifest_hash TEXT NOT NULL,
    manifest_signature TEXT NOT NULL,
    manifest JSON NOT NULL,
    endpoint TEXT NOT NULL,
    transports JSON NOT NULL,
    tags JSON NOT NULL,
    trust_score REAL DEFAULT 0.0,
    trust_score_updated_at TEXT,
    certificate TEXT,
    registered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_heartbeat_at TEXT,
    ttl_seconds INTEGER DEFAULT 86400,
    status TEXT DEFAULT 'active',
    authoritative_node TEXT NOT NULL,
    federation_version INTEGER DEFAULT 1
);

CREATE INDEX idx_agents_namespace ON agents(namespace);
CREATE INDEX idx_agents_service ON agents(service);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_tags ON agents(tags);  -- Requires JSON index support
```

**PostgreSQL** (production, multi-node):
- Same schema with Postgres-native JSON operators
- Full-text search on capabilities.description
- Vector embeddings for semantic capability search (optional)

### 3.3 Trust Score Computation

```python
class TrustScoreEngine:
    WEIGHTS = {
        "task_completion_rate": 0.30,
        "latency_accuracy": 0.15,
        "uptime": 0.20,
        "incident_rate": 0.20,
        "certificate_age": 0.15,
    }

    def compute(self, agent: AgentRecord, heartbeats: list[Heartbeat]) -> float:
        if len(heartbeats) < 10:
            # Insufficient data — return low confidence score
            return 0.1

        components = {
            "task_completion_rate": self._completion_rate(heartbeats),
            "latency_accuracy": self._latency_accuracy(agent, heartbeats),
            "uptime": self._uptime(heartbeats),
            "incident_rate": 1.0 - self._incident_rate(heartbeats),
            "certificate_age": self._certificate_age_score(agent),
        }

        return sum(score * self.WEIGHTS[key] for key, score in components.items())
```

### 3.4 Certificate Issuance

```python
import jwt
from datetime import datetime, timedelta

class CertificateIssuer:
    def __init__(self, node_private_key: str, node_id: str):
        self.private_key = node_private_key
        self.node_id = node_id

    def issue(self, agent: AgentRecord, ttl_hours: int = 24) -> str:
        now = datetime.utcnow()
        payload = {
            "iss": self.node_id,
            "sub": agent.ans_id,
            "iat": now,
            "exp": now + timedelta(hours=ttl_hours),
            "public_key": agent.public_key,
            "ans_version": "0.1",
            "manifest_hash": agent.manifest_hash,
        }
        return jwt.encode(payload, self.private_key, algorithm="EdDSA")
```

---

## 4. ANS SDK Design

### 4.1 Python SDK (`mcp_use.ans`)

Module structure:
```
mcp_use/ans/
├── __init__.py          # Public API exports
├── client.py            # ANSClient - main entry point
├── registry.py          # RegistryConnection - HTTP client for registry
├── manifest.py          # CapabilityManifest - data model + signing
├── keys.py              # KeyPair - Ed25519 key management
├── trust.py             # TrustVerifier - certificate verification
└── exceptions.py        # ANSNotFoundError, ANSCertExpiredError, etc.
```

**Public API:**
```python
from mcp_use.ans import ANSClient, CapabilityManifest

# Initialize client with registry URL
client = ANSClient(registry="https://registry.ans.example.com")

# Register an agent
manifest = CapabilityManifest(
    ans_id="search.acme-corp.web-researcher",
    name="Web Researcher",
    description="Searches and summarizes web content",
    endpoint="https://agents.acme-corp.com/web-researcher",
    transports=["http", "mcp"],
    capabilities=[...],
    tags=["web", "search"],
)
result = await client.register(manifest, private_key_path="~/.ans/keys/web-researcher.pem")

# Resolve an agent
agent = await client.resolve("search.acme-corp.web-researcher")
print(agent.endpoint)          # "https://agents.acme-corp.com/web-researcher"
print(agent.trust_score)       # 0.87

# Search for agents
agents = await client.search(tags=["web", "search"], min_trust=0.7)

# Report heartbeat (from agent's own process)
await client.heartbeat(
    ans_id="search.acme-corp.web-researcher",
    status="healthy",
    latency_p50_ms=120,
)
```

**Integration with MCPAgent:**
```python
from mcp_use import MCPAgent
from mcp_use.ans import ANSClient

# MCPAgent can use ANS IDs instead of hardcoded URLs
agent = MCPAgent(
    llm=llm,
    ans_client=ANSClient(registry="https://registry.ans.example.com"),
)

# The agent will resolve ANS IDs at runtime
response = await agent.run(
    "Use search.public.web-search to find information about MCP",
    # ^ ANS ID is auto-resolved before calling
)
```

### 4.2 TypeScript SDK (`mcp-use/ans`)

Module structure:
```
src/ans/
├── index.ts             # Public exports
├── client.ts            # ANSClient
├── registry.ts          # RegistryClient - fetch-based HTTP
├── manifest.ts          # CapabilityManifest - types + signing
├── keys.ts              # KeyPair - Web Crypto API
├── trust.ts             # TrustVerifier
└── errors.ts            # ANSError, ANSNotFoundError, etc.
```

**Public API (TypeScript):**
```typescript
import { ANSClient, CapabilityManifest } from 'mcp-use/ans';

const client = new ANSClient({ registry: 'https://registry.ans.example.com' });

// Register an agent
const manifest = new CapabilityManifest({
  ansId: 'search.acme-corp.web-researcher',
  name: 'Web Researcher',
  endpoint: 'https://agents.acme-corp.com/web-researcher',
  transports: ['http', 'mcp'],
  capabilities: [...],
  tags: ['web', 'search'],
});

const result = await client.register(manifest, { privateKeyPath: '~/.ans/keys/web-researcher.pem' });

// Resolve
const agent = await client.resolve('search.acme-corp.web-researcher');

// Search
const agents = await client.search({ tags: ['web', 'search'], minTrust: 0.7 });
```

**MCPServer auto-registration:**
```typescript
import { MCPServer } from 'mcp-use/server';
import { ANSClient } from 'mcp-use/ans';

const server = new MCPServer({
  name: 'web-researcher',
  version: '1.0.0',
  // ANS auto-registration
  ans: {
    client: new ANSClient({ registry: 'https://registry.ans.example.com' }),
    ansId: 'search.acme-corp.web-researcher',
    privateKeyPath: '~/.ans/keys/web-researcher.pem',
    heartbeatInterval: 60_000, // 1 minute
  },
});

// Server auto-registers on start() and sends heartbeats
await server.start();
```

---

## 5. Security Architecture

### 5.1 Key Management

**Key Generation (SDK):**
```python
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

def generate_keypair() -> tuple[str, str]:
    """Returns (private_key_pem, public_key_b64)"""
    private_key = Ed25519PrivateKey.generate()
    # ... serialize to PEM + base64
```

**Key Storage**: Private keys are stored by the agent operator, never by the registry. The SDK provides helpers for:
- File-based storage (`~/.ans/keys/`)
- Environment variable injection (`ANS_PRIVATE_KEY`)
- Cloud KMS integration hooks (AWS KMS, GCP KMS)

**Key Rotation**: Agents rotate keys by submitting a new manifest signed with both the old key (proves ownership) and the new key (proves possession). The registry validates the transition.

### 5.2 Request Verification Flow

```
Agent A wants to call Agent B:

1. A → Registry:  GET /v1/agents/resolve/search.acme-corp.B
2. Registry → A:  { endpoint, public_key, certificate }
3. A verifies:    JWT certificate signature (issued by known registry)
4. A → B:        POST {endpoint} with signed request header
                  X-ANS-Signature: ed25519:<base64_sig_of_request_body>
                  X-ANS-ID: search.acme-corp.A
5. B verifies:    Resolves A's public key from registry (cached)
                  Verifies signature
6. B → A:        Response with X-ANS-Signature header
7. A verifies:    Response signature using B's known public key
```

After step 2, the registry is NOT in the hot path. All subsequent verification is peer-to-peer.

### 5.3 Replay Attack Prevention

Each signed request includes:
- `X-ANS-Timestamp`: Unix timestamp (milliseconds)
- `X-ANS-Nonce`: Random 32-byte value, base64 encoded
- Signature covers: `body + timestamp + nonce`

Receivers reject requests where `timestamp` is more than 5 minutes old. Nonces are cached in a rolling 10-minute window to prevent replay within that window.

### 5.4 Registry Node Trust

When an ANS client is configured with a registry, it pins the registry's public key. This prevents MITM attacks if the registry domain is compromised.

The client ships with a set of well-known registry public keys (similar to browser CA bundles). Users can add custom registry keys for private deployments.

---

## 6. Federation Protocol Detail

### 6.1 Sync Algorithm

Registry nodes use a **pull-based sync** with vector clocks for conflict resolution:

```python
class FederationSync:
    async def sync_from_peer(self, peer: FederationPeer):
        # Pull all changes since last sync
        response = await self.http.get(
            f"{peer.url}/v1/federation/agents",
            params={"since": peer.last_sync_at.isoformat()}
        )

        for agent_record in response["agents"]:
            existing = await self.db.get_agent(agent_record["ans_id"])

            if existing is None:
                # New agent — insert
                await self.db.insert_agent(agent_record)
            elif existing.federation_version < agent_record["federation_version"]:
                # Peer has newer version — update
                await self.db.update_agent(agent_record)
            elif existing.federation_version > agent_record["federation_version"]:
                # We have newer version — skip (peer will sync from us)
                pass
            else:
                # Same version — check for conflict
                if existing.manifest_hash != agent_record["manifest_hash"]:
                    await self._handle_conflict(existing, agent_record)

        peer.last_sync_at = datetime.utcnow()
        await self.db.update_peer(peer)
```

### 6.2 Namespace Authority

Nodes declare authority over namespaces in their configuration:
```yaml
# registry-config.yaml
node_id: "registry.ans.example.com"
authoritative_namespaces:
  - "public"
  - "oss"
federated_peers:
  - url: "https://eu.registry.ans.example.com"
    namespaces: ["eu"]
  - url: "https://registry.acme-corp.internal"
    namespaces: ["acme-corp"]
    private: true  # Don't re-expose to the public network
```

### 6.3 Conflict Resolution Policy

When two nodes have conflicting manifests:

1. **Same namespace, different data**: Prefer the authoritative node
2. **No clear authority**: Prefer higher `federation_version`
3. **Same version, different hash**: Mark as `disputed`, do not serve, alert operators
4. **Different public keys for same ANS ID**: Always disputed — ANS ID hijacking attempt, alert + block

---

## 7. Scalability Characteristics

### 7.1 Read Path (Resolution)

Resolution is the hot path. Design:
- In-memory LRU cache in the registry (configurable size)
- CDN-cacheable responses (Cache-Control headers with TTL from manifest)
- Read replicas for high-traffic deployments
- Target: <10ms p99 for cache hits, <50ms for cache misses

### 7.2 Write Path (Registration + Heartbeat)

Registration is infrequent. Heartbeats are frequent:
- Registration: synchronous, < 100ms acceptable
- Heartbeat: async background writes, batched, < 500ms acceptable
- Federation sync: async, every 5 minutes

### 7.3 Storage Estimates

| Metric | Estimate |
|--------|---------|
| Average manifest size | 2-5 KB |
| 10,000 agents | ~50 MB |
| 1M agents | ~5 GB |
| Heartbeat records (30 days) | ~10x agent count |

SQLite comfortably handles 100k agents. PostgreSQL handles the full production scale.

---

## 8. Implementation Roadmap

### Phase 1: Core Protocol (Weeks 1-4)
- [ ] JSON Schema for capability manifests (`schemas/agent-manifest.json`)
- [ ] Python SDK: `mcp_use/ans/` module
  - [ ] KeyPair generation and storage
  - [ ] CapabilityManifest signing
  - [ ] ANSClient (register, resolve, search, heartbeat)
  - [ ] Unit tests
- [ ] TypeScript SDK: `src/ans/` module (mirrors Python)
- [ ] Reference registry server (Python/FastAPI, SQLite backend)
- [ ] Basic federation (single-hop sync)

### Phase 2: Integration (Weeks 5-8)
- [ ] MCPAgent ANS integration (resolve ANS IDs at runtime)
- [ ] MCPServer auto-registration on startup
- [ ] Reference agents (10+ wrappers for popular services)
- [ ] Docker image for registry node
- [ ] Integration tests (agent → registry → agent flow)

### Phase 3: Trust Layer (Weeks 9-16)
- [ ] Full trust score computation from heartbeat data
- [ ] Certificate lifecycle (issuance, renewal, revocation)
- [ ] Key rotation workflow
- [ ] Trust Oracle API (hosted service)
- [ ] Compliance audit logging

### Phase 4: Hosted Service (Weeks 17-24)
- [ ] Hosted registry with multi-tenant isolation
- [ ] Dashboard UI
- [ ] PostgreSQL backend
- [ ] Geographic distribution (CDN + regional replicas)
- [ ] SLA monitoring and alerting

---

## 9. Testing Strategy

### Unit Tests
- Key generation and signing/verification
- Manifest serialization and hashing
- Trust score computation with fixture data
- Federation conflict resolution logic

### Integration Tests
- Full registration → resolution → verification flow
- Heartbeat and trust score update
- Key rotation workflow
- Federation sync between two test nodes
- Replay attack rejection

### Load Tests
- Resolution throughput (target: 1000 RPS per node)
- Registration throughput (target: 100 RPS per node)
- Federation sync with 10k agents

---

## 10. Directory Structure

```
ANS/
├── README.md                  # Entry point
├── PROTOCOL.md                # Protocol specification
├── STRATEGY.md                # Strategic vision
├── ARCHITECTURE.md            # This document
├── schemas/
│   ├── agent-manifest.json    # JSON Schema for manifests
│   ├── heartbeat.json         # Heartbeat payload schema
│   ├── resolution.json        # Resolution response schema
│   └── certificate.json       # JWT certificate payload schema
├── examples/
│   ├── python/
│   │   ├── register_agent.py  # Register an agent
│   │   ├── resolve_agent.py   # Resolve and call an agent
│   │   └── mcpagent_with_ans.py  # MCPAgent using ANS
│   └── typescript/
│       ├── register-agent.ts
│       ├── resolve-agent.ts
│       └── mcp-server-with-ans.ts
└── reference-implementation/
    └── README.md              # Where the registry server code will live
```
