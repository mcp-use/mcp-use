---
"mcp-use": patch
---

Coordinate model context contributions through immutable send snapshots, preserve description order, and correctly handle coalesced operations, synchronous widget failures, retries, and disposal without changing existing transport defaults. Keep newer operation waiters separate from older write failures, compare Unicode object keys deterministically, fence test resets, and preserve attachment generation identity without retaining removed keys.
