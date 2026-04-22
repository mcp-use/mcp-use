---
"@mcp-use/inspector": patch
---

Add Open Graph and Twitter Card meta tags (title, description, image, site) plus `<meta name="description">` to the inspector HTML, so links to the hosted inspector render rich previews on Slack, X/Twitter, LinkedIn, Discord, and other platforms. Ships a branded `inspector-cover.png` in `public/` and serves it from `/inspector/inspector-cover.png` in both the default and CDN-shell paths.
