---
"mcp-use": patch
---

fix(server): restore Claude resource domain hashing on `resources/read`

v1.29.0 rewrote `_meta.ui.domain` to `<sha256(domain)[0..32]>.claudemcpcontent.com` for clients whose advertised name contains "claude"; 2.0.0 dropped that along with the v1 server package, so Claude got the authored `view.domain` verbatim and refused to render the view. The hash and the client match are byte-for-byte the v1 ones, so a server upgrading from v1 emits the same domain it did before. Every non-Claude client still gets the authored value verbatim, an already-hashed authored domain passes through unchanged, and `resources/list` is untouched — same as v1.

Client identity comes from the per-request `_meta` envelope (`io.modelcontextprotocol/clientInfo`) on 2026-07-28-era traffic. Because 2025-era requests carry no per-request identity, HTTP requests fall back to a `User-Agent` containing `claude`; other legacy clients keep the verbatim domain.
