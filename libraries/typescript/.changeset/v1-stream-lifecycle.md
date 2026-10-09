---
"mcp-use": patch
---

Release Redis SSE controllers, heartbeat timers, and subscriptions on disconnect, failed registration, reconnect, and shutdown. Session termination now releases local registrations and attempts both remote cleanups even if Redis is unavailable.

Avoid reading or cloning SSE response bodies in request logging so open streams are delivered immediately. Keep Hono query middleware native, propagate rejected async Connect middleware to the error handler, and allow ordinary Connect `next()` calls to reach downstream handlers.
