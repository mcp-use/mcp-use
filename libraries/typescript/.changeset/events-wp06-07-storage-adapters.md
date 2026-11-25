---
"mcp-use": minor
---

Storage: `memoryStorage`, the new `fileStorage`, `redisStorage` and `upstashStorage` implement the full `McpUseStorage` contract (KV with compare-and-set, counters, sorted indexes, the compound event log, signal, batch and removePrefix) and pass `runStorageConformance`.
