---
"mcp-use": patch
---

Fix OAuth error handling to redirect back to inspector instead of showing raw error page. When OAuth callback receives an error (e.g. user denies access), the callback now looks up the stored state first to retrieve the returnUrl, then redirects back to the inspector with error parameters instead of immediately throwing and displaying a raw error page with stack traces.
