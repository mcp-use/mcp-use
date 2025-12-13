# Session Store Tests

Comprehensive tests for MCP session storage implementations.

## Running Tests

### Basic Tests (In-Memory Only)

```bash
pnpm test tests/unit/server/session-stores.test.ts
```

This runs tests for `InMemorySessionStore` and mocked Redis client.

### Redis Integration Tests

To run tests with a real Redis instance, use Infisical to load environment variables:

```bash
# From the mcp-use package directory
infisical run --env=dev --projectId=13272018-648f-41fd-911c-908a27c9901e -- pnpm test tests/unit/server/session-stores.test.ts

# Or use the convenience script
./tests/scripts/test-redis.sh
```

Required environment variables (loaded by Infisical):
- `REDIS_URL` or `REDISHOST` - Redis connection URL or host
- `REDIS_PASSWORD` or `REDISPASSWORD` - Redis password (if required)
- `REDISPORT` - Redis port (default: 6379)
- `REDISUSER` - Redis username (if required)

### Installing Redis Client

If you want to run real Redis integration tests, install the Redis client:

```bash
pnpm add -D redis
```

## Test Coverage

### InMemorySessionStore Tests

- ✅ Basic CRUD operations (get, set, delete, has)
- ✅ Session listing (keys)
- ✅ Size tracking
- ✅ Clear all sessions
- ✅ TTL support with auto-deletion
- ✅ Multiple sessions management
- ✅ Update operations

### RedisSessionStore Tests

#### Mock Redis Tests
- ✅ Basic CRUD operations
- ✅ Session listing
- ✅ Custom key prefix
- ✅ TTL support
- ✅ Serialization/deserialization
- ✅ Clear all sessions

#### Real Redis Integration Tests (Optional)
- ✅ Real Redis connection
- ✅ Concurrent operations
- ✅ Production-like scenarios

## Test Structure

```typescript
// Tests are organized by store type and functionality
describe('InMemorySessionStore', () => {
  describe('Basic Operations', () => { ... });
  describe('TTL Support', () => { ... });
  describe('Update Operations', () => { ... });
});

describe('RedisSessionStore', () => {
  describe('Mock Redis Client Tests', () => { ... });
  describe('Real Redis Integration Tests', () => { ... });
});
```

## Implementation Notes

### Mock Redis Client

The tests include a mock Redis client that simulates Redis behavior:

- In-memory storage with Map
- TTL support with setTimeout
- Proper expiry checking
- All SessionStore interface methods

This allows tests to run without a real Redis instance.

### Real Redis Tests

Real Redis integration tests are conditional:

- Only run if Redis environment variables are available
- Skip gracefully if Redis client is not installed
- Use a test prefix (`test:mcp:session:`) to avoid conflicts
- Clean up after each test

## Debugging Tests

### View Test Output

```bash
pnpm test tests/unit/server/session-stores.test.ts -- --reporter=verbose
```

### Run Specific Test

```bash
pnpm test tests/unit/server/session-stores.test.ts -t "should set and get session data"
```

### Run Only Redis Tests

```bash
infisical run --env=dev --projectId=13272018-648f-41fd-911c-908a27c9901e -- pnpm test tests/unit/server/session-stores.test.ts -t "RedisSessionStore"
```

