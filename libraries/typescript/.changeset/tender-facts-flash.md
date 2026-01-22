---
"@mcp-use/inspector": patch
"mcp-use": patch
---

fix: improve widget rendering and session management

- Fix widget iframe reload by adding timestamp query parameter to force refresh when widget data changes
- Add retry logic with exponential backoff for dev widget fetching to handle Vite dev server cold starts
- Fix default session idle timeout from 5 minutes to 1 day to prevent premature session expiration
- Fix session lastAccessedAt tracking to update both persistent store and in-memory map
- Fix _meta merging to preserve existing fields (e.g., openai/outputTemplate) when updating tools and widgets
- Add support for frame_domains and redirect_domains in widget CSP metadata
