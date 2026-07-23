---
"mcp-use": patch
---

Add anonymous v2 server usage metrics for server composition, feature adoption,
client protocol capabilities, and sampled operation outcomes. Persist a random
per-server identity in the project's gitignored `.mcp-use/usage.json` when
storage is available, while retaining runtime-scoped correlation and privacy
safeguards.
