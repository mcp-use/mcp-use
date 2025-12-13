# MCP Server Scale Testing Suite

Comprehensive test suite for validating MCP server performance, stability, and resilience under production-scale loads.

## Overview

This suite tests the complete MCP server implementation including:
- **Tools**: Fast echo, CPU-intensive, I/O-bound operations
- **Resources**: Static and dynamic content
- **Prompts**: Template rendering
- **Notifications**: Server-to-client push (tools/resources/prompts list changes)
- **Sampling**: Server-to-client LLM requests (if client supports)
- **Elicitation**: Server-to-client user input requests (if client supports)
- **Session Management**: Redis-based distributed sessions
- **Stream Management**: Redis Pub/Sub for cross-server notifications

## Quick Start

### Prerequisites

```bash
# Install dependencies
pnpm install

# Install k6 for load testing (optional)
brew install k6  # macOS
# or download from https://k6.io/

# Start Redis (or use cloud Redis)
docker run -d -p 6379:6379 redis:7-alpine

# Set Redis URL
export REDIS_URL="redis://localhost:6379"
# Or use the provided Railway instance
export REDIS_URL="redis://default:VzXiwOMMIerTFlfYnRvrItAETVjJczDn@turntable.proxy.rlwy.net:39849"
```

### Run Quick Tests

```bash
# Start test server (in one terminal)
npx tsx tests/scale/test-server.ts

# Run capability matrix (5 minutes)
npx tsx tests/scale/capability-matrix.ts

# Run notification stress test (100 clients, quick)
REDIS_URL=redis://... npx tsx tests/scale/notification-stress.ts --clients=100 --per-batch=10 --batches=5

# Run mixed workload (100 clients, 5 minutes)
REDIS_URL=redis://... npx tsx tests/scale/load-mixed-workload.ts --clients=100 --duration=300000 --rpm=10
```

## Test Scenarios

### 1. Capability Matrix Test

Tests all MCP features with different client capability profiles.

**Run:**
```bash
npx tsx tests/scale/capability-matrix.ts
```

**Tests:**
- Minimal client (no special capabilities)
- Sampling-only client
- Elicitation-only client
- Full-featured client

**Duration:** 2-3 minutes

**Success Criteria:**
- All core features (tools, resources, prompts) work with all client types
- Advanced features (sampling, elicitation) gracefully degrade when not supported

### 2. Mixed Workload Load Test

Simulates realistic production usage with varying operations.

**Run:**
```bash
# 100 clients, 5 minutes
REDIS_URL=redis://... npx tsx tests/scale/load-mixed-workload.ts --clients=100 --duration=300000 --rpm=10

# 1000 clients, 30 minutes (heavy load)
REDIS_URL=redis://... npx tsx tests/scale/load-mixed-workload.ts --clients=1000 --duration=1800000 --rpm=20
```

**Workload Mix:**
- 40% fast tool calls (fast-echo)
- 15% CPU-intensive (slow-computation)
- 15% I/O-bound (fetch-data)
- 15% resource reads
- 10% prompts
- 3% notifications
- 1% sampling
- 1% elicitation

**Success Criteria:**
- < 1% error rate
- p95 latency < 100ms
- No memory leaks

### 3. Notification Stress Test

Tests notification delivery to many concurrent SSE clients.

**Run:**
```bash
# 100 clients (quick test)
REDIS_URL=redis://... npx tsx tests/scale/notification-stress.ts --clients=100 --per-batch=10 --batches=5

# 1000 clients (production scale)
REDIS_URL=redis://... npx tsx tests/scale/notification-stress.ts --clients=1000 --per-batch=20 --batches=10
```

**Parameters:**
- `--clients=N`: Number of SSE clients
- `--per-batch=N`: Notifications per batch
- `--batches=N`: Number of batches
- `--delay=N`: Delay between batches (ms)

**Success Criteria:**
- ≥ 99% delivery rate
- p95 latency < 500ms
- All clients receive all notifications

### 4. Long-Running Stability Test

Runs for 24-72 hours to detect memory leaks and degradation.

**Run:**
```bash
# 1 hour (for testing)
REDIS_URL=redis://... npx tsx tests/scale/long-running-sessions.ts --duration=1 --clients=100

# 24 hours (production validation)
REDIS_URL=redis://... npx tsx tests/scale/long-running-sessions.ts --duration=24 --clients=100

# 72 hours (comprehensive)
REDIS_URL=redis://... npx tsx tests/scale/long-running-sessions.ts --duration=72 --clients=200
```

**Parameters:**
- `--duration=N`: Test duration in hours
- `--clients=N`: Number of concurrent clients
- `--interval=N`: Request interval in ms
- `--snapshot-interval=N`: Memory snapshot interval in ms

**Outputs:**
- Memory snapshots saved to `test-results/longevity/memory-snapshots.jsonl`
- Final report: `test-results/longevity/longevity-report-<timestamp>.json`

**Success Criteria:**
- < 50% heap growth over duration
- < 1% error rate
- No crashes
- Stable performance (no degradation)

### 5. k6 Load Test

Industry-standard load testing with k6.

**Run:**
```bash
# Quick test (100 VUs, 1 minute)
k6 run --vus=100 --duration=1m tests/scale/k6-mcp-server.js

# Moderate load (1000 VUs, 10 minutes)
k6 run --vus=1000 --duration=10m tests/scale/k6-mcp-server.js

# Full scenario suite (includes baseline, ramping, spike)
k6 run tests/scale/k6-mcp-server.js

# With JSON output for analysis
k6 run --out json=results.json tests/scale/k6-mcp-server.js
```

**Scenarios:**
- **Baseline**: 50 VUs constant for 5 minutes
- **Ramping**: 0 → 100 → 500 → 1000 over 15 minutes
- **Spike**: 0 → 2000 for 1 minute (sudden burst)

**Thresholds:**
- p(95) < 500ms for HTTP requests
- p(95) < 200ms for tool calls
- < 1% error rate

### 6. Chaos Engineering Tests

Tests resilience under failure conditions.

**Run:**
```bash
REDIS_URL=redis://... npx tsx tests/scale/chaos-test.ts
```

**Scenarios:**
- Server restart during active sessions
- Redis connection failure (manual)
- Network latency injection

**Success Criteria:**
- Clients auto-recover from server restart
- Graceful degradation during failures
- Full recovery after failures resolve

### 7. Distributed Deployment Test

Tests 3-server deployment with load balancing.

**Run:**
```bash
# Start distributed environment
cd tests/scale
docker-compose up -d

# Wait for services to be healthy
docker-compose ps

# Run distributed test
npx tsx distributed-deployment.ts

# Cleanup
docker-compose down
```

**Tests:**
- Cross-server session sharing
- Notification delivery across servers via Redis Pub/Sub
- Load balancing with nginx
- Session affinity

## Monitoring

### Real-time Monitoring

All tests output progress to console. For long-running tests, monitor:

```bash
# Watch test progress
tail -f test-results/longevity/memory-snapshots.jsonl

# Monitor Redis
redis-cli -h <host> -p <port> -a <password> --stat

# Monitor specific keys
redis-cli -h <host> -p <port> -a <password> KEYS "test:mcp:*"
```

### Prometheus Metrics

The test server exposes Prometheus metrics at `/metrics`:

```bash
curl http://localhost:3000/metrics
```

**Key Metrics:**
- `mcp_tool_calls_total` - Total tool invocations
- `mcp_resource_reads_total` - Total resource reads
- `mcp_notifications_sent_total` - Notifications sent
- `mcp_active_sessions` - Current active sessions
- `mcp_active_sse_streams` - Current SSE connections
- `mcp_request_duration_seconds` - Request latency histogram
- `mcp_errors_total` - Total errors

### Grafana Dashboard

Import the provided Grafana dashboard to visualize metrics:

```bash
# TODO: Add Grafana dashboard JSON
```

## Interpreting Results

### Load Test Success

✅ **Good** if:
- Error rate < 1%
- p95 latency < 100ms (moderate load)
- No memory growth > 20% during test
- No crashes or connection errors

⚠️ **Warning** if:
- Error rate 1-5%
- p95 latency 100-500ms
- Memory growing but stable
- Occasional connection errors

❌ **Failed** if:
- Error rate > 5%
- p95 latency > 500ms
- Memory continuously growing (leak)
- Frequent crashes

### Notification Delivery

✅ **Good**: ≥ 99.9% delivery rate, p95 < 100ms
⚠️ **Acceptable**: ≥ 99% delivery rate, p95 < 500ms
❌ **Poor**: < 99% delivery rate or p95 > 500ms

### Memory Leak Detection

Check memory snapshots:

```typescript
// Linear growth = potential leak
// Sawtooth pattern = normal GC
// Stable with occasional spikes = healthy
```

**Red flags:**
- Continuous upward trend (> 10% per hour)
- No GC sawtooth pattern
- RSS growing faster than heap

## Troubleshooting

### High Error Rates

**Possible causes:**
- Redis connection issues
- Server overload (increase resources)
- Network timeouts (check Docker network)
- Too many concurrent connections

**Solutions:**
- Reduce client count
- Increase server resources
- Check Redis capacity
- Review error logs

### Poor Notification Delivery

**Possible causes:**
- Redis Pub/Sub not working
- Clients using wrong transport (HTTP instead of SSE)
- Network issues between servers and Redis

**Solutions:**
- Verify Redis Pub/Sub: `redis-cli PUBSUB CHANNELS`
- Check client transport type
- Test Redis connectivity from each server

### Memory Leaks

**Detection:**
- Heap growing > 50% over 24 hours
- RSS growing faster than heap
- GC not reclaiming memory

**Investigation:**
- Take heap snapshot: `node --heapsnapshot-signal=SIGUSR2`
- Profile with Chrome DevTools
- Check for un-closed resources
- Review event listener cleanup

## Best Practices

1. **Start Small**: Begin with 10-100 clients before scaling to thousands
2. **Monitor Early**: Watch metrics from the start to establish baseline
3. **Use Redis**: Always test with Redis for realistic distributed behavior
4. **Run Longevity**: At least 24 hours before production deployment
5. **Test Chaos**: Verify resilience before going live
6. **Document Baselines**: Save results for regression testing

## CI/CD Integration

Add to GitHub Actions:

```yaml
# .github/workflows/scale-tests.yml
name: Scale Tests

on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sunday
  workflow_dispatch:

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Start Redis
        run: docker run -d -p 6379:6379 redis:7-alpine
      
      - name: Run capability matrix
        run: pnpm test:scale:capability
        env:
          REDIS_URL: redis://localhost:6379
      
      - name: Run load test
        run: pnpm test:scale:load
        env:
          REDIS_URL: redis://localhost:6379
      
      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: scale-test-results
          path: test-results/
```

## Support

For questions or issues:
- GitHub Issues: https://github.com/mcp-use/mcp-use/issues
- Discord: https://discord.gg/XkNkSkMz3V
- Documentation: https://mcp-use.com/docs

---

**Last Updated:** December 2024
**Maintainer:** mcp-use team
