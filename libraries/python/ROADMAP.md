# Roadmap

This roadmap outlines planned work for the mcp-use SDK. It covers both protocol compliance and feature development.

For the latest status, see our [GitHub Issues](https://github.com/mcp-use/mcp-use/issues) and [MCP-1371 (Tier 1 tracking)](https://linear.app/mcp-use/issue/MCP-1371).

## Current Status

### Python SDK
- **Server conformance**: 30/30 (100%)
- **Client conformance**: 20/20 (100%)
- **Latest stable release**: v1.6.0

### TypeScript SDK
- **Server conformance**: 28/30 (93%)
- **Client conformance**: In progress

## Q1 2026 — Protocol Compliance

### Python
- [x] Full server conformance (30/30) — logging, completions, subscriptions, DNS rebinding
- [x] Full client conformance (20/20) — OAuth flows, CIMD, scope step-up, SSE retry
- [x] Resource subscription broadcasting (#1004)
- [x] `logging/setLevel` with RFC 5424 level filtering (#1004)
- [x] `dns_rebinding_protection` server parameter (#1004)
- [x] Replace deprecated `streamablehttp_client` (#1017)
- [ ] TypeScript client conformance parity (#1009)
- [ ] TypeScript server DNS rebinding fix
- [ ] TypeScript server SEP-1330 enum elicitation

### Infrastructure
- [x] Conformance CI for server + client (GitHub Actions)
- [x] Conformance action with badge generation and PR comments
- [ ] Tier-check integration (blocked on monorepo support: https://github.com/modelcontextprotocol/conformance/issues)

## Q2 2026 — SDK Improvements

### Client Architecture (#943–#948)
- [ ] Define Connector and Auth protocol interfaces (#943)
- [ ] Typed Auth classes: BearerAuth, OAuthAuth, BasicAuth, APIKeyAuth (#944)
- [ ] Refactor HttpConnector and StdioConnector with per-connector config (#947)
- [ ] BaseConnector with lazy auto-connect (#945)
- [ ] MCPClient as Connector with recursive composition (#948)
- [ ] Connector-to-Server transformation via `as_server()` (#949)

### Server Features
- [ ] Server-side OAuth authentication (#955)
- [ ] Python skill support for mcp-use server (#956)
- [ ] `MCPServer.mount()` for composing servers (#951)
- [ ] Dependency injection support (Depends) for tools (#870)
- [ ] MCP-UI support in Python server (#942)

### Developer Experience
- [ ] Caching middleware (#754)
- [ ] Clean public API exports for 2.0 (#953)
- [ ] `uvx` template for MCP server creation (#862)

## Future

- Package splitting for Python 3.12+ (#860)
- Backward compatibility layer for 1.x config format (#952)
- Per-connector callbacks for sampling, elicitation, logging (#950)

## How to Contribute

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines. Issues labeled [`good first issue`](https://github.com/mcp-use/mcp-use/labels/good%20first%20issue) are a great starting point.
