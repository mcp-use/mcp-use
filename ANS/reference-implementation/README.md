# ANS Reference Registry — Implementation Guide

This directory will contain the reference implementation of the ANS Registry Node.

## Planned Stack

- **Language**: Python (FastAPI)
- **Database**: SQLite (default) / PostgreSQL (production)
- **Auth**: Ed25519 signature verification (no external auth service needed for basic ops)
- **Deployment**: Docker image, deployable on any cloud or on-premise

## Planned Directory Structure

```
reference-implementation/
├── README.md               (this file)
├── pyproject.toml
├── src/
│   └── ans_registry/
│       ├── __init__.py
│       ├── main.py         # FastAPI application
│       ├── routes/
│       │   ├── agents.py   # Register, resolve, search, heartbeat
│       │   └── federation.py  # Federation sync endpoints
│       ├── models/
│       │   ├── agent.py    # SQLAlchemy models
│       │   └── federation.py
│       ├── services/
│       │   ├── registry.py # Core registry logic
│       │   ├── trust.py    # Trust score computation
│       │   ├── certs.py    # Certificate issuance
│       │   ├── federation.py  # Federation sync
│       │   └── crypto.py   # Ed25519 operations
│       ├── config.py       # Configuration (env vars)
│       └── db.py           # Database setup
├── tests/
│   ├── unit/
│   └── integration/
├── Dockerfile
└── docker-compose.yml      # Registry + PostgreSQL
```

## API Endpoints (Planned)

```
POST   /v1/agents/register                  Register a new agent
GET    /v1/agents/resolve/{ans_id}          Resolve ANS ID to endpoint
GET    /v1/agents/search                    Search agents by tags/query
POST   /v1/agents/{ans_id}/heartbeat        Report agent health
GET    /v1/agents/{ans_id}/manifest         Get full manifest
DELETE /v1/agents/{ans_id}                  Deregister (agent auth required)
GET    /v1/federation/agents                Federation sync endpoint
POST   /v1/federation/announce              Register as a federation peer
GET    /v1/health                           Health check
GET    /v1/stats                            Registry statistics
```

## Quick Start (Once Implemented)

```bash
# Run with Docker
docker run -p 8080:8080 ghcr.io/mcp-use/ans-registry:latest

# Or from source
pip install -e ".[dev]"
ans-registry serve --port 8080 --db sqlite:///./ans.db
```

## Configuration

```env
ANS_NODE_ID=https://registry.my-org.com
ANS_PRIVATE_KEY_PATH=~/.ans/node.pem
ANS_DB_URL=postgresql://user:pass@localhost:5432/ans
ANS_FEDERATION_PEERS=https://eu.registry.example.com,https://us.registry.example.com
ANS_HEARTBEAT_TIMEOUT_SECONDS=300
ANS_TTL_DEFAULT_SECONDS=86400
```

## Contributing

Once development begins, contributions welcome following the same patterns as the rest of mcp-use:
- Run `ruff check --fix && ruff format` before commits
- Tests are mandatory
- See root [CLAUDE.md](../../CLAUDE.md) for workflow requirements
