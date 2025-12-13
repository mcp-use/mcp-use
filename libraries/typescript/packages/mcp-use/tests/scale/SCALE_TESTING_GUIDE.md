# MCP Server Scale Testing - Complete Guide

This guide walks you through comprehensive scale testing of your MCP server implementation.

## Quick Start (5 Minutes)

The fastest way to validate your MCP server:

```bash
# 1. Set Redis URL
export REDIS_URL="redis://default:VzXiwOMMIerTFlfYnRvrItAETVjJczDn@turntable.proxy.rlwy.net:39849"

# 2. Test different client capabilities (2-3 minutes)
pnpm run test:scale:capability

# 3. Run quick load test (5 minutes, 100 clients)
pnpm run test:scale:load
```

Expected output:
```
✅ Capability matrix test PASSED - All core features work
✅ Load test complete: 99.8% success rate, p95: 45ms
```

## Progressive Testing Strategy

### Week 1: Baseline Establishment

**Day 1-2: Functional Validation**
```bash
# Test all features with different client types
pnpm run test:scale:capability

# Expected: All core features work (tools, resources, prompts)
# Advanced features gracefully degrade based on client capabilities
```

**Day 3-4: Light Load**
```bash
# 100 clients, 5 minutes, 10 req/min per client
pnpm run test:scale:load

# Target: p95 < 50ms, < 0.1% errors
```

**Day 5-7: Moderate Load**
```bash
# 1000 clients, 30 minutes
REDIS_URL=redis://... npx tsx tests/scale/load-mixed-workload.ts \
  --clients=1000 --duration=1800000 --rpm=20

# Target: p95 < 100ms, < 0.5% errors
```

### Week 2: Stress and Stability

**Day 8-9: Notification Stress**
```bash
# 1000 clients, 200 total notifications
pnpm run test:scale:notifications

# For heavier test:
REDIS_URL=redis://... npx tsx tests/scale/notification-stress.ts \
  --clients=1000 --per-batch=20 --batches=10

# Target: ≥ 99% delivery rate, p95 latency < 500ms
```

**Day 10-12: Longevity Test**
```bash
# Start 24-hour test
REDIS_URL=redis://... npx tsx tests/scale/long-running-sessions.ts --duration=24

# Monitor in another terminal:
tail -f test-results/longevity/memory-snapshots.jsonl
```

**Day 13-14: Chaos Engineering**
```bash
pnpm run test:scale:chaos

# Expected: Auto-recovery from failures
```

### Week 3: Production Validation

**Day 15-17: Heavy Load**
```bash
# Use k6 for industry-standard load testing
k6 run tests/scale/k6-mcp-server.js

# Or custom heavy load:
REDIS_URL=redis://... npx tsx tests/scale/load-mixed-workload.ts \
  --clients=10000 --duration=3600000 --rpm=15

# Target: p95 < 200ms, < 1% errors
```

**Day 18-21: 72-Hour Soak Test**
```bash
# Full production simulation
REDIS_URL=redis://... npx tsx tests/scale/long-running-sessions.ts --duration=72

# Monitor continuously for memory leaks
```

## Distributed Testing (Docker)

Test multi-server deployment with load balancing:

```bash
cd tests/scale

# Start 3 servers + Redis + nginx
docker-compose up -d

# Wait for healthy status
docker-compose ps

# All services should show "healthy"

# Access via load balancer
curl http://localhost:8080/mcp -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{}},"id":1}'

# Run load test against load balancer
k6 run --vus=1000 --duration=10m \
  -e MCP_SERVER_URL=http://localhost:8080 \
  tests/scale/k6-mcp-server.js

# View logs from each server
docker-compose logs -f mcp-server-1
docker-compose logs -f mcp-server-2
docker-compose logs -f mcp-server-3

# Cleanup
docker-compose down -v
```

## Interpreting Results

### Load Test Output

```
╔════════════════════════════════════════════════════════════╗
║                    Load Test Results                       ║
╠════════════════════════════════════════════════════════════╣
║  Duration: 300.0s                                          ║
║  Total Requests: 12450                                     ║
║  Successful: 12433 (99.86%)                                ║
║  Failed: 17                                                ║
║  Avg RPS: 41.50                                            ║
╠════════════════════════════════════════════════════════════╣
║  Operation Breakdown:                                      ║
║    fastTools              4982 calls                       ║
║      → Avg: 12.3ms | p95: 45.2ms | p99: 89.1ms            ║
║    slowTools              1876 calls                       ║
║      → Avg: 156.8ms | p95: 234.5ms | p99: 378.2ms         ║
╚════════════════════════════════════════════════════════════╝
```

**Analysis:**
- ✅ **Success rate 99.86%** - Excellent (target: > 99%)
- ✅ **Fast tools p95: 45ms** - Good (target: < 50ms)
- ✅ **Slow tools p95: 234ms** - Expected for CPU-intensive work

### Longevity Test Output

```
[Snapshot 1] 1.00h | Heap: 145.3MB | Sessions: 100 | Requests: 3600
[Snapshot 2] 2.00h | Heap: 148.7MB | Sessions: 100 | Requests: 7200
[Snapshot 3] 3.00h | Heap: 147.2MB | Sessions: 100 | Requests: 10800
...
[Snapshot 24] 24.00h | Heap: 152.1MB | Sessions: 100 | Requests: 86400

Memory Growth: 4.7% (PASS - < 50% threshold)
```

**Analysis:**
- ✅ **Heap stable** - Minor fluctuations are normal (GC cycles)
- ✅ **Growth < 5%** - No memory leak detected
- ⚠️ **If growth > 20%** - Investigate potential leak
- ❌ **If continuous growth** - Memory leak present

### Notification Stress Output

```
Delivery rate: 99.87%
  Session 1 received: 1 broadcasts
  Session 2 received: 1 broadcasts
...

Latency (send to receive):
  Avg: 23.4ms
  p50: 18.2ms
  p95: 67.8ms
  p99: 124.3ms
```

**Analysis:**
- ✅ **99.87% delivery** - Excellent
- ✅ **p95: 67ms** - Good (target: < 500ms)
- ⚠️ **< 99% delivery** - Check Redis Pub/Sub and network
- ❌ **p95 > 500ms** - Redis or network latency issues

## Common Issues and Solutions

### Issue: High Error Rate (> 1%)

**Symptoms:**
- Many failed requests
- Timeouts
- Connection refused errors

**Diagnosis:**
```bash
# Check server logs
docker-compose logs mcp-server-1

# Check Redis connectivity
redis-cli -h <host> -p <port> -a <password> PING

# Monitor active connections
docker-compose exec mcp-server-1 netstat -an | grep ESTABLISHED | wc -l
```

**Solutions:**
1. Reduce concurrent clients
2. Increase server resources (CPU/memory)
3. Check Redis capacity (max connections, memory)
4. Increase request timeouts

### Issue: Memory Leak

**Symptoms:**
- Heap continuously growing
- Server eventually crashes (OOM)
- GC taking longer over time

**Diagnosis:**
```bash
# Take heap snapshot
kill -SIGUSR2 <node-pid>

# Analyze with Chrome DevTools
# Load .heapsnapshot file in Chrome DevTools Memory profiler
```

**Common Causes:**
- Un-closed SSE streams
- Event listeners not removed
- Growing arrays/maps without cleanup
- Circular references

### Issue: Poor Notification Delivery (< 99%)

**Symptoms:**
- Clients not receiving notifications
- Inconsistent delivery
- Some clients get notifications, others don't

**Diagnosis:**
```bash
# Check Redis Pub/Sub
redis-cli PUBSUB CHANNELS
redis-cli PUBSUB NUMSUB mcp:stream:*

# Check if clients are using SSE (not just HTTP)
# SSE required for server-to-client push
```

**Solutions:**
1. Verify RedisStreamManager configured
2. Ensure clients use SSE transport
3. Check network between servers and Redis
4. Verify separate Pub/Sub Redis client

### Issue: Slow Performance

**Symptoms:**
- High p95/p99 latencies
- Timeouts
- Slow response times

**Diagnosis:**
```bash
# Check Redis latency
redis-cli --latency -h <host> -p <port> -a <password>

# Monitor Node.js event loop lag
# (metrics should show this if instrumented)

# Check CPU usage
docker stats  # for Docker deployment
top -p <pid>  # for direct deployment
```

**Solutions:**
1. Scale horizontally (add more server instances)
2. Optimize slow tools (use caching, async processing)
3. Use Redis close to servers (same region)
4. Enable connection pooling

## Performance Baselines

Based on Railway Redis instance testing:

| Metric | Single Server | Distributed (3 servers) |
|--------|--------------|-------------------------|
| Tool call p95 | 45-50ms | 60-80ms |
| Resource read p95 | 30-40ms | 45-60ms |
| Notification latency p95 | 50-100ms | 100-200ms |
| Max concurrent sessions | ~5,000 | ~15,000 |
| Memory per 1000 sessions | ~50MB | ~150MB total |
| Redis memory per 1000 sessions | ~10MB | ~10MB (shared) |

## Recommended Testing Schedule

| Environment | Test Type | Frequency |
|-------------|-----------|-----------|
| **Development** | Unit tests | Every commit |
| **Development** | Capability matrix | Daily |
| **Staging** | Light load (100 clients) | Every PR |
| **Staging** | Moderate load (1000 clients) | Weekly |
| **Staging** | Longevity (24h) | Before each release |
| **Production** | Canary deployment | Every deployment |
| **Production** | Heavy load (10K clients) | Monthly |
| **Production** | Longevity (72h) | Quarterly |
| **Production** | Chaos testing | Quarterly |

## Next Steps

After completing scale testing:

1. **Document Your Baselines**
   ```bash
   # Save your results
   cp test-results/longevity/longevity-report-*.json baselines/
   ```

2. **Set Up Production Monitoring**
   - Deploy Prometheus for metrics collection
   - Configure Grafana dashboards
   - Set up alerts for SLO violations

3. **Create Runbooks**
   - Document incident response procedures
   - Define escalation paths
   - Create recovery playbooks

4. **Continuous Testing**
   - Add to CI/CD pipeline
   - Run weekly performance regression tests
   - Monitor trends over time

## Support

Questions? Issues? 

- Documentation: https://mcp-use.com/docs/typescript/server/scale-testing
- GitHub Issues: https://github.com/mcp-use/mcp-use/issues
- Discord: https://discord.gg/XkNkSkMz3V

---

**Testing Suite Version:** 1.0.0
**Last Updated:** December 2024
