# Manual Integration Tests

These tests verify the Redis session management implementation with a real Redis instance.

## Running Tests

### Quick Test with Provided Redis URL

```bash
npx tsx tests/manual/test-redis-integration.ts
```

This will test:
- RedisSessionStore: metadata storage and retrieval
- RedisStreamManager: Pub/Sub message delivery
- Multiple sessions
- Broadcast functionality
- Cleanup operations

### Using Custom Redis URL

Edit `test-redis-integration.ts` and change the `REDIS_URL` constant, or set it as an environment variable:

```bash
REDIS_URL="redis://user:pass@host:port" npx tsx tests/manual/test-redis-integration.ts
```

### Using Infisical for Environment Variables

```bash
infisical run --env=dev --projectId=13272018-648f-41fd-911c-908a27c9901e -- npx tsx tests/manual/test-redis-integration.ts
```

## Test Coverage

The manual integration test verifies:

1. **RedisSessionStore**
   - ✅ Setting and getting session metadata
   - ✅ Multiple sessions
   - ✅ Keys listing
   - ✅ Deletion and cleanup

2. **RedisStreamManager**
   - ✅ Creating streams with Pub/Sub subscriptions
   - ✅ Sending messages to specific sessions
   - ✅ Broadcasting to all sessions
   - ✅ Message delivery across Pub/Sub
   - ✅ Cleanup and unsubscribe

3. **Integration**
   - ✅ Both stores working together
   - ✅ No conflicts or race conditions
   - ✅ Proper cleanup on shutdown

## Expected Output

When successful, you should see:

```
🚀 Testing Redis Session Management Integration

Connecting to Redis...
✅ Connected to Redis

📦 Testing RedisSessionStore...
  Setting session metadata...
  Retrieving session metadata...
✅ RedisSessionStore: Metadata stored and retrieved correctly

  Testing multiple sessions...
✅ RedisSessionStore: Multiple sessions working

🌊 Testing RedisStreamManager...
  Creating stream for session...
✅ RedisStreamManager: Stream created

  Testing Pub/Sub message delivery...
  📨 Received message via Pub/Sub: ...
✅ RedisStreamManager: Pub/Sub delivery working

  Testing broadcast to multiple streams...
✅ RedisStreamManager: Broadcast working

🧹 Testing cleanup...
✅ Cleanup successful

🎉 All Redis integration tests passed!
```

## Troubleshooting

### Connection Errors

If you get connection errors, verify:
- Redis server is accessible
- URL format is correct: `redis://[user]:[password]@[host]:[port]`
- Firewall allows connection to Redis port
- Credentials are valid

### Pub/Sub Not Working

If messages aren't being received:
- Ensure you're using TWO separate Redis clients (one for Pub/Sub, one for regular commands)
- Check that `pubSubClient` is only used for subscribe/unsubscribe
- Check that `client` is used for publish and other commands

### node-redis vs ioredis

The implementation supports both:
- **node-redis v5+**: Uses `setEx`, `publish`, `subscribe` methods
- **ioredis**: Uses `setex`, `publish`, `subscribe` methods

The code auto-detects which client is being used.

