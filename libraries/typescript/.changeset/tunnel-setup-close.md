---
"@mcp-use/tunnel": patch
---

Fail tunnel setup as soon as the relay closes the connection, and release the reservation when setup fails. The setup promise rejected on a transport `error` but ignored `close`, so a relay that accepted the socket and then rejected the handshake, which is what an expired or invalid tunnel token produces, left the promise pending until the 30 second timeout and then reported `Tunnel setup timed out` instead of the relay's own close reason. A stale persisted reservation paid that cost on every one of the five reattach attempts before falling back to a fresh tunnel. Separately, a reservation that was created and then failed to connect was abandoned rather than deleted, leaving a tunnel allocated on the relay until it expired.
