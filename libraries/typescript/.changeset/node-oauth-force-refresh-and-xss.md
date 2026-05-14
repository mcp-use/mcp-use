---
"mcp-use": patch
---

fix(auth): make `forceRefresh()` actually exchange the refresh_token, and escape HTML in the loopback failure page

- `NodeOAuthClientProvider.forceRefresh()` now delegates to a new
  `OAuthSessionStore.forceRefresh()` that calls the existing dedup'd
  refresh path directly. The previous implementation tried to coerce a
  refresh by zeroing out `access_token` and re-reading via `tokens()`,
  but `tokens()` gates the refresh path on a truthy `access_token`, so
  no network call was ever made and the stale tokens were returned. This
  is what `mcp-use client auth refresh` runs.
- The loopback failure page (rendered when the OAuth server redirects
  back with `?error=…`) now HTML-escapes both the `error` code and
  `error_description` rather than only stripping `<>&` from the
  description. Closes a low-severity reflected-XSS in the localhost
  callback page.
