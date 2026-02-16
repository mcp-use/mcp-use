# Roadmap — Python SDK

This roadmap outlines planned work for the mcp-use Python SDK. It covers protocol compliance, SDK architecture, and core feature development.

For the latest status, see our [GitHub Issues](https://github.com/mcp-use/mcp-use/issues) and [MCP-1371 (Tier 1 tracking)](https://linear.app/mcp-use/issue/MCP-1371).

## Current Status

- **Server conformance**: 30/30 (100%)
- **Client conformance**: 20/20 (100%)
- **Latest stable release**: v1.6.0

## Q1 2026 — Protocol Compliance

- [x] Full server conformance (30/30) — logging, completions, subscriptions, DNS rebinding
- [x] Full client conformance (20/20) — OAuth flows, CIMD, scope step-up, SSE retry
- [x] Resource subscription broadcasting (#1004)
- [x] `logging/setLevel` with RFC 5424 level filtering (#1004)
- [x] `dns_rebinding_protection` server parameter (#1004)
- [x] Replace deprecated `streamablehttp_client` (#1017)
- [x] Conformance CI for server + client (GitHub Actions)

## Q2 2026 — SDK 2.0 Architecture

### Connector & Auth Redesign
- [ ] Define Connector protocol and Auth protocol interfaces (#943)
- [ ] Typed Auth classes: BearerAuth, OAuthAuth, BasicAuth, APIKeyAuth (#944)
- [ ] BaseConnector with lazy auto-connect (#945)
- [ ] TransformedConnector for middleware-style transformations (#946)
- [ ] Refactor HttpConnector and StdioConnector with per-connector config (#947)
- [ ] MCPClient as Connector with recursive composition (#948)
- [ ] Connector-to-Server transformation via `as_server()` (#949)
- [ ] Per-connector callbacks for sampling, elicitation, logging (#950)

### Server
- [ ] Server-side OAuth authentication (#955)
- [ ] `MCPServer.mount()` for composing servers (#951)
- [ ] Dependency injection (Depends) for tools (#870)

### Protocol
- [ ] Custom OAuth discovery URLs (#864)
- [ ] Sampling support in Python client (#863)

### Release
- [ ] Clean public API exports for 2.0 (#953)
- [ ] Backward compatibility layer for 1.x config format (#952)

## Future

- Adapter deduplication (#842)

## How to Contribute

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines. Issues labeled [`good first issue`](https://github.com/mcp-use/mcp-use/labels/good%20first%20issue) are a great starting point.
