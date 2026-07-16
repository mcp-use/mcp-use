# `@mcp-use/client` examples

## Four-server matrix

Run each command in a separate terminal:

```bash
cd _demo-servers
pnpm install --ignore-workspace
PORT=3101 pnpm official:v1 # official SDK, legacy stateful HTTP
PORT=3102 pnpm official:v2 # official SDK, modern stateless HTTP
PORT=3103 pnpm ours:v1     # mcp-use v1, full features + MCP Apps
PORT=3104 pnpm ours:v2     # mcp-use v2, modern features + MCP Apps
```

The official servers isolate protocol negotiation and transport behavior. The
mcp-use servers reuse our full v1 conformance server and v2 MCP Apps reference
server so feature examples exercise real framework implementations.

Run the complete matrix:

```bash
# from packages/client
./examples/run-with-demo-servers.sh
```

## Feature examples

- `node/basic-http.ts` — tools + automatic v1/v2 negotiation.
- `node/communication/sampling-client.ts` — v1 reverse request and v2
  `input_required` sampling.
- `node/communication/elicitation-client.ts` — v1 reverse request and v2
  multi-round-trip form elicitation.
- `node/communication/notification-client.ts` — asynchronous v1 notifications
  and legacy root updates.
- `node/communication/completion-client.ts` — prompt/resource completion in v1
  and prompt completion in v2.
- `node/communication/capabilities-client.ts` — client capability advertisement,
  MCP Apps tool metadata, and structured content in both eras.
- `node/auth/oauth-flow.ts` — self-contained OAuth discovery, DCR, PKCE loopback,
  code exchange, and token persistence.
- `browser/basic-http.ts` — browser entry smoke under `tsx`.
- `browser/react/` — `useMcp`, four-server `McpClientProvider`, OAuth callback,
  notification queues, sampling, and elicitation UI.
- `browser/commonjs/` — dynamic ESM import from a CommonJS host.
- `cli/` — name-scoped CLI scripts.
- `conformance/` — official MCP conformance harness clients.

Individual examples use ports 3103/3104 by default and accept
`MCP_SERVER_URL` / `MCP_SERVER_V2_URL` overrides.
