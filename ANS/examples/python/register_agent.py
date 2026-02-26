"""
ANS Example: Register an agent with the ANS registry.

This shows how an agent registers itself, generating a keypair and
posting its capability manifest to an ANS registry node.

Prerequisites:
    pip install mcp-use[ans]  # (planned; not yet published)

Usage:
    python register_agent.py
"""

import asyncio
import json
from pathlib import Path

# These imports reflect the planned mcp_use.ans module structure.
# See ANS/ARCHITECTURE.md for the full SDK design.
# from mcp_use.ans import ANSClient, CapabilityManifest, KeyPair


# ─── Standalone demo (no actual mcp_use.ans yet) ────────────────────────────

import base64
import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class Capability:
    name: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] | None = None


@dataclass
class CapabilityManifest:
    ans_id: str
    name: str
    description: str
    version: str
    endpoint: str
    transports: list[str]
    capabilities: list[Capability]
    tags: list[str] = field(default_factory=list)
    rate_limit: str | None = None
    contact: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ans_version": "0.1",
            "id": self.ans_id,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "endpoint": self.endpoint,
            "transport": self.transports,
            "capabilities": [
                {
                    "name": cap.name,
                    "description": cap.description,
                    "input_schema": cap.input_schema,
                    **({"output_schema": cap.output_schema} if cap.output_schema else {}),
                }
                for cap in self.capabilities
            ],
            "constraints": {
                **({"rate_limit": self.rate_limit} if self.rate_limit else {}),
            },
            "trust": {
                "public_key": "ed25519:PLACEHOLDER",  # Real impl: filled by KeyPair
                "signature": "PLACEHOLDER",  # Real impl: signed manifest hash
            },
            "meta": {
                "created_at": datetime.utcnow().isoformat() + "Z",
                "tags": self.tags,
                **({"contact": self.contact} if self.contact else {}),
            },
        }

    def canonical_json(self) -> bytes:
        """Returns the canonical JSON for signing (stable key ordering, no signature field)."""
        d = self.to_dict()
        d["trust"].pop("signature", None)
        return json.dumps(d, sort_keys=True, separators=(",", ":")).encode()

    def manifest_hash(self) -> str:
        return hashlib.sha256(self.canonical_json()).hexdigest()


# ─── Example usage ─────────────────────────────────────────────────────────

async def main():
    # 1. Define your agent's capability manifest
    manifest = CapabilityManifest(
        ans_id="search.my-org.web-researcher",
        name="Web Researcher",
        description=(
            "Searches the web and synthesizes information into structured reports. "
            "Supports English, Italian, and French queries."
        ),
        version="1.0.0",
        endpoint="https://agents.my-org.com/web-researcher",
        transports=["mcp", "http"],
        tags=["web", "search", "research"],
        rate_limit="100/hour",
        contact="platform@my-org.com",
        capabilities=[
            Capability(
                name="search",
                description="Search the web for information on a topic",
                input_schema={
                    "type": "object",
                    "required": ["query"],
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query",
                        },
                        "max_results": {
                            "type": "integer",
                            "default": 10,
                            "minimum": 1,
                            "maximum": 50,
                        },
                        "language": {
                            "type": "string",
                            "enum": ["en", "it", "fr"],
                            "default": "en",
                        },
                    },
                },
                output_schema={
                    "type": "object",
                    "properties": {
                        "results": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {"type": "string"},
                                    "url": {"type": "string"},
                                    "snippet": {"type": "string"},
                                },
                            },
                        },
                        "summary": {"type": "string"},
                    },
                },
            ),
        ],
    )

    # 2. Show the manifest that would be signed and submitted
    print("=== ANS Capability Manifest ===")
    print(json.dumps(manifest.to_dict(), indent=2))
    print()
    print(f"Manifest hash (for signing): {manifest.manifest_hash()}")
    print()

    # 3. When mcp_use.ans is available, registration would look like:
    print("=== Registration (pseudo-code, awaiting mcp_use.ans module) ===")
    print("""
    from mcp_use.ans import ANSClient, KeyPair

    # Generate or load your keypair
    keypair = KeyPair.load_or_generate("~/.ans/keys/web-researcher.pem")

    # Initialize the client
    client = ANSClient(registry="https://registry.ans.example.com")

    # Sign and register
    result = await client.register(manifest, keypair=keypair)
    print(f"Registered: {result.ans_id}")
    print(f"Certificate: {result.certificate}")
    print(f"Trust score: {result.trust_score}")
    """)

    # 4. Heartbeat (keep registration alive)
    print("=== Heartbeat (pseudo-code) ===")
    print("""
    import asyncio

    async def heartbeat_loop(client, ans_id, keypair):
        while True:
            await client.heartbeat(
                ans_id=ans_id,
                keypair=keypair,
                status="healthy",
                latency_p50_ms=120,
                latency_p99_ms=800,
            )
            await asyncio.sleep(60)  # Every minute
    """)


if __name__ == "__main__":
    asyncio.run(main())
