/**
 * Framework storage (`mcp-use/storage`): the `McpUseStorage` contract shared
 * by `oauthProxy` and MCP Events, and its adapters. Each adapter takes a
 * client or binding the application already has, so no database driver is
 * a dependency of this package, and each accepts a `prefix` that is
 * prepended to every key it writes.
 *
 * @packageDocumentation
 */
export type {
  IndexAddOptions,
  IndexCountQuery,
  IndexEntry,
  IndexRangePage,
  IndexRangeQuery,
  LogAppendOptions,
  LogAppendResult,
  LogEntry,
  LogRangeOptions,
  LogRangeResult,
  LogTrimOptions,
  McpUseStorage,
  StorageCapabilities,
  StorageIncrOptions,
  StorageOp,
  StorageRemoveOptions,
  StorageSignal,
  StorageWriteOptions,
  Versioned,
} from "./types.js";
export { memoryStorage, type MemoryStorageOptions } from "./adapters/memory.js";
export {
  upstashStorage,
  type UpstashStorageOptions,
} from "./adapters/upstash.js";
export {
  redisStorage,
  type IORedisLikeClient,
  type NodeRedisLikeClient,
  type RedisLikeClient,
  type RedisStorageOptions,
} from "./adapters/redis.js";
export {
  postgresStorage,
  type PostgresLikeClient,
  type PostgresPoolClientLike,
  type PostgresStorageOptions,
} from "./adapters/postgres.js";
export {
  cloudflareStorage,
  type CloudflareStorageOptions,
  type D1LikeBoundStatement,
  type D1LikeDatabase,
} from "./adapters/cloudflare-d1.js";
export {
  McpUseStorageDurableObject,
  type DurableObjectNamespaceLike,
  type McpUseDurableObjectStorageLike,
} from "./adapters/cloudflare-do.js";
