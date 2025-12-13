# Scale Testing Quick Start

Get started with MCP server scale testing in 5 minutes.

## Prerequisites

```bash
# 1. Install dependencies (if not already done)
cd libraries/typescript/packages/mcp-use
pnpm install

# 2. Set Redis URL (use Railway instance or local)
export REDIS_URL="redis://default:VzXiwOMMIerTFlfYnRvrItAETVjJczDn@turntable.proxy.rlwy.net:39849"
# Or local Redis:
# export REDIS_URL="redis://localhost:6379"
```

## Run Your First Test (2 minutes)

```bash
# Test that all MCP features work with different client types
pnpm run test:scale:capability
```

Expected output:
```
╔═══════════════════════════════════════════════════════════╗
║         Client Capability Matrix Test                     ║
╚═══════════════════════════════════════════════════════════╝

Testing different client capability profiles...

Profile         Tools  Resources  Prompts  Sampling  Elicitation
Minimal Client   ✅      ✅         ✅        ⊘          ⊘
Sampling Client  ✅      ✅         ✅        ✅         ⊘
Full-Featured    ✅      ✅         ✅        ✅         ✅

✅ Capability matrix test PASSED
```

## Run Load Test (5 minutes)

```bash
# 100 concurrent clients making requests for 5 minutes
pnpm run test:scale:load
```

Expected output:
```
╔════════════════════════════════════════════════════════════╗
║                    Load Test Results                       ║
╠════════════════════════════════════════════════════════════╣
║  Duration: 300.0s                                          ║
║  Total Requests: ~10,000                                   ║
║  Successful: ~9,990 (99.9%)                                ║
║  Avg RPS: ~33                                              ║
╠════════════════════════════════════════════════════════════╣
║  Operation Breakdown:                                      ║
║    fastTools: Avg: 12ms | p95: 45ms | p99: 89ms           ║
║    resources: Avg: 8ms  | p95: 30ms | p99: 56ms           ║
╚════════════════════════════════════════════════════════════╝
```

## Test Notifications (2 minutes)

```bash
# Test notification delivery to 100 SSE clients
pnpm run test:scale:notifications
```

Expected output:
```
Overall delivery rate: 99.87%
Latency p95: 67ms

✅ Notification stress test PASSED
```

## What These Tests Validate

| Test | What It Checks | Why It Matters |
|------|----------------|----------------|
| **Capability Matrix** | All features work with different client types | Ensures backward compatibility |
| **Load Test** | Performance under concurrent load | Validates production capacity |
| **Notification Stress** | Redis Pub/Sub at scale | Critical for distributed deployments |

## Next Steps

### For Development
```bash
# Run all quick tests before each release
pnpm run test:scale:all
```

### For Production Validation
```bash
# 1. Test with expected peak load
REDIS_URL=redis://... npx tsx tests/scale/load-mixed-workload.ts \
  --clients=1000 --duration=1800000 --rpm=20

# 2. Run 24-hour stability test
REDIS_URL=redis://... npx tsx tests/scale/long-running-sessions.ts --duration=24

# 3. Test distributed deployment
cd tests/scale
docker-compose up -d
# Wait for healthy, then run tests against http://localhost:8080
```

### For Comprehensive Validation
```bash
# Use k6 for industry-standard load testing
brew install k6
k6 run tests/scale/k6-mcp-server.js
```

## Troubleshooting

### "Connection refused" errors
- Start the test server first: `pnpm run scale:server`
- Or tests will start it automatically

### "Redis connection failed"
- Verify REDIS_URL is set correctly
- Test connection: `redis-cli -u $REDIS_URL PING`

### Low performance
- Start: This is expected for unbuilt code in development
- Build first: `pnpm build` then test against dist/

### Import errors
- Tests use src/ files directly (works with tsx)
- For production testing, build first and test dist/

## Understanding Results

✅ **Good Performance:**
- Load test: p95 < 100ms, success rate > 99%
- Notifications: delivery rate > 99%, p95 latency < 500ms
- No memory growth over time

⚠️ **Needs Investigation:**
- p95 latency 100-500ms
- Success rate 95-99%
- Moderate memory growth (10-30%)

❌ **Action Required:**
- p95 latency > 500ms → Optimize or scale horizontally
- Success rate < 95% → Fix errors before production
- Memory continuously growing → Memory leak

## Full Documentation

- Complete guide: `tests/scale/SCALE_TESTING_GUIDE.md`
- All test details: `tests/scale/README.md`
- Online docs: https://mcp-use.com/docs/typescript/server/scale-testing

---

**Total time to validate:** ~10 minutes for quick tests, 24-72 hours for comprehensive validation
