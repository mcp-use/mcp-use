---
"mcp-use": patch
"@mcp-use/inspector": patch
---

Fix OAuth error handling to redirect back to inspector instead of showing raw error page. When OAuth callback receives an error (e.g. user denies access), the callback now looks up the stored state first to retrieve the returnUrl, then redirects back to the inspector with error parameters instead of immediately throwing and displaying a raw error page with stack traces. The inspector surfaces these errors as a toast at the App level so it fires regardless of route and after the toaster has subscribed.
