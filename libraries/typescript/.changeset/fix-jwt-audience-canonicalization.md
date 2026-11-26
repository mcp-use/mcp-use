---
"mcp-use": patch
---

Canonicalize URL-shaped JWT `aud` values before matching them against the protected resource, so trailing slashes, host casing, and explicit default ports no longer break OAuth token validation. Non-URL provider audiences remain non-binding on the audience path.
