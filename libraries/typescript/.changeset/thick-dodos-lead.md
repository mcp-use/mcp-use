---
"@mcp-use/inspector": patch
---

fix(inspector): add logic to detect when server= contains a URL that's not already connected and automatically redirect to use autoConnect= instead

**Connection Handling:**

- Enhanced Layout component to detect when `server=` URL parameter is provided but no matching connection exists
- Automatically redirects to use `autoConnect=` parameter for seamless connection establishment
- Updated dependencies in useEffect hook to include connections and navigate for improved functionality

**Documentation:**

- Added comprehensive URL parameters documentation page to inspector reference
- Included examples and usage patterns for `server=`, `autoConnect=`, and other query parameters

Resolves #932

Commits: 37af1bf7
