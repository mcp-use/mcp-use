---
"mcp-use": patch
---

`CSP_URLS` now only adds domains to a view's `connectDomains` and `resourceDomains`. It no longer fills `frameDomains` or `baseUriDomains`, which ChatGPT app review reads as a request to embed third-party iframes. Set `CSP_FRAME_DOMAINS` or `CSP_BASE_URI_DOMAINS`, or a view's `csp`, to declare those explicitly.
