---
"mcp-use": minor
---

New `McpUseStorage` storage contract shared by `oauthProxy` and MCP Events: key-value with compare-and-set and TTL, counters, sorted indexes and an append-only log with dedupe, plus optional `readMany`, `batch`, `signal` and `removePrefix`. New `runStorageConformance()` and `runStorageIsolationCheck()` validate any store, and `countingStorage()` counts storage calls per operation. `upstashStorage`, `redisStorage`, `postgresStorage` and `cloudflareStorage` accept a `prefix` option that is prepended to every key they write. `MCP_USE_STORAGE_URL`, `MCP_USE_STORAGE_TOKEN` and `MCP_USE_STORAGE_PREFIX` select a store from the environment. The storage adapters moved to their own modules; `mcp-use/oauth/storage` exports the same factories. One fix: `redisStorage` now works with ioredis clients, which it previously sent to ioredis's `sendCommand` (which takes a `Command` object) instead of `call`; node-redis clients behave as before.
