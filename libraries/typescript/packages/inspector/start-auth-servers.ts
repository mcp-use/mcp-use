#!/usr/bin/env tsx
/**
 * Start all authentication test servers
 *
 * This script starts API Key, Custom Header, and OAuth mock servers
 * for running authentication E2E tests.
 *
 * Usage:
 *   tsx start-auth-servers.ts
 *   # or with pnpm
 *   pnpm tsx start-auth-servers.ts
 */

import { AuthServersManager } from "./tests/e2e/fixtures/auth-servers.js";

const manager = new AuthServersManager();

async function main() {
  console.log("🚀 Starting authentication test servers...\n");

  try {
    await manager.startAll();

    console.log("\n✅ All authentication test servers are running!");
    console.log("\n📋 Server URLs:");
    console.log("   API Key:        http://localhost:3003/mcp");
    console.log("   Custom Header:  http://localhost:3004/mcp");
    console.log("   OAuth Linear:   http://localhost:3105/mcp");
    console.log("   OAuth Supabase: http://localhost:3106/mcp");
    console.log("   OAuth GitHub:   http://localhost:3107/mcp");
    console.log("   OAuth Vercel:   http://localhost:3108/mcp");

    console.log("\n🔑 Valid credentials:");
    console.log("   API Key:        Authorization: Bearer test-api-key-12345");
    console.log("   Custom Header:  X-Custom-Auth: custom-auth-token-xyz");
    console.log("   OAuth:          Mock OAuth flow (auto-approved)");

    console.log("\n▶️  Run tests with:");
    console.log("   pnpm test:e2e auth-flows.test.ts");

    console.log("\n⏹️  Press Ctrl+C to stop all servers\n");

    // Keep the process alive
    process.on("SIGINT", async () => {
      console.log("\n\n🛑 Stopping all servers...");
      await manager.stopAll();
      console.log("✅ All servers stopped");
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\n\n🛑 Stopping all servers...");
      await manager.stopAll();
      console.log("✅ All servers stopped");
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    console.error("\n❌ Failed to start authentication test servers:", error);
    process.exit(1);
  }
}

main();
