---
"mcp-use": minor
---

Add `views.resourceUri` so a server can choose each view's `ui://` resource URI.
Hosts cache view documents by URI, so a server that redeploys a view needs to be
able to publish a new URI. The resolver is called once per primed view and its
result is used on `tools/list`, successful `tools/call` results, view resource
registration, and the OAuth gate's open-resource list. Without a resolver, every
view keeps its existing `ui://views/<name>.html` URI.
