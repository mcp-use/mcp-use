/**
 * ANS Example: Register an agent with the ANS registry (TypeScript).
 *
 * This shows how a TypeScript/Node.js agent registers itself, generating
 * a keypair and posting its capability manifest to an ANS registry node.
 *
 * Prerequisites:
 *   npm install mcp-use  # ans module planned in upcoming release
 *
 * Usage:
 *   npx tsx register-agent.ts
 */

import crypto from "node:crypto";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Capability {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
}

interface CapabilityManifest {
  ans_version: string;
  id: string;
  name: string;
  description: string;
  version: string;
  endpoint: string;
  transport: string[];
  capabilities: Capability[];
  constraints?: {
    rate_limit?: string;
    max_context_tokens?: number;
    supported_languages?: string[];
    requires_auth?: boolean;
  };
  trust: {
    public_key: string;
    signature?: string;
  };
  meta: {
    created_at: string;
    updated_at?: string;
    tags?: string[];
    contact?: string;
    license?: string;
  };
}

// ─── Manifest Builder ──────────────────────────────────────────────────────

function buildManifest(): CapabilityManifest {
  return {
    ans_version: "0.1",
    id: "search.my-org.web-researcher",
    name: "Web Researcher",
    description:
      "Searches the web and synthesizes information into structured reports. " +
      "Supports English, Italian, and French queries.",
    version: "1.0.0",
    endpoint: "https://agents.my-org.com/web-researcher",
    transport: ["mcp", "http"],
    capabilities: [
      {
        name: "search",
        description: "Search the web for information on a topic",
        input_schema: {
          type: "object",
          required: ["query"],
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
            max_results: {
              type: "integer",
              default: 10,
              minimum: 1,
              maximum: 50,
            },
            language: {
              type: "string",
              enum: ["en", "it", "fr"],
              default: "en",
            },
          },
        },
        output_schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                  snippet: { type: "string" },
                },
              },
            },
            summary: { type: "string" },
          },
        },
      },
    ],
    constraints: {
      rate_limit: "100/hour",
      max_context_tokens: 32000,
      supported_languages: ["en", "it", "fr"],
      requires_auth: false,
    },
    trust: {
      public_key: "ed25519:PLACEHOLDER", // Real impl: populated from KeyPair
    },
    meta: {
      created_at: new Date().toISOString(),
      tags: ["web", "search", "research"],
      contact: "platform@my-org.com",
      license: "proprietary",
    },
  };
}

// ─── Canonical JSON for signing ────────────────────────────────────────────

function canonicalJson(manifest: CapabilityManifest): Buffer {
  // Remove signature field before hashing, sort keys deterministically
  const { trust, ...rest } = manifest;
  const { signature: _, ...trustWithoutSig } = trust;
  const forSigning = { ...rest, trust: trustWithoutSig };
  return Buffer.from(JSON.stringify(forSigning, Object.keys(forSigning).sort()));
}

function manifestHash(manifest: CapabilityManifest): string {
  return crypto.createHash("sha256").update(canonicalJson(manifest)).digest("hex");
}

// ─── Main demo ─────────────────────────────────────────────────────────────

async function main() {
  const manifest = buildManifest();

  console.log("=== ANS Capability Manifest ===");
  console.log(JSON.stringify(manifest, null, 2));
  console.log();
  console.log(`Manifest hash (for signing): ${manifestHash(manifest)}`);
  console.log();

  // When mcp-use/ans is available, registration would look like:
  console.log("=== Registration (pseudo-code, awaiting mcp-use/ans module) ===");
  console.log(`
  import { ANSClient, KeyPair } from 'mcp-use/ans';

  // Generate or load keypair (stored in ~/.ans/keys/)
  const keypair = await KeyPair.loadOrGenerate('web-researcher');

  // Initialize the client
  const client = new ANSClient({ registry: 'https://registry.ans.example.com' });

  // Build manifest with real public key
  const manifest = buildManifest();
  manifest.trust.public_key = keypair.publicKeyEncoded;

  // Sign and register
  const result = await client.register(manifest, { keypair });
  console.log('Registered:', result.ansId);
  console.log('Certificate:', result.certificate);
  console.log('Trust score:', result.trustScore);
  `);

  // MCPServer auto-registration
  console.log("=== MCPServer Auto-Registration (pseudo-code) ===");
  console.log(`
  import { MCPServer } from 'mcp-use/server';
  import { ANSClient } from 'mcp-use/ans';

  const server = new MCPServer({
    name: 'web-researcher',
    version: '1.0.0',
    // ANS registration happens automatically on server.start()
    ans: {
      client: new ANSClient({ registry: 'https://registry.ans.example.com' }),
      ansId: 'search.my-org.web-researcher',
      privateKeyPath: '~/.ans/keys/web-researcher.pem',
      heartbeatIntervalMs: 60_000, // Report health every minute
    },
  });

  server.tool({
    name: 'search',
    description: 'Search the web',
    schema: z.object({ query: z.string() }),
    handler: async ({ query }) => {
      // ... implementation
    },
  });

  await server.start(); // Also registers to ANS
  `);
}

main().catch(console.error);
