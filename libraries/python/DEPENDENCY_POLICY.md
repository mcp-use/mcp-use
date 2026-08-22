# Dependency Policy

This document describes how mcp-use manages its dependencies for the Python SDK.

## Python Version Support

- **Minimum supported**: Python 3.11
- **Tested on CI**: Python 3.11, 3.12
- **Policy**: We support the two most recent minor Python versions. When a new Python version is released, we add support within one release cycle and may drop the oldest supported version with a major version bump.

## MCP SDK (`mcp` package)

The `mcp` package is our core dependency — it provides the MCP protocol implementation.

- **Supported range**: `mcp>=1.24.0,<2.0.0`
- **Update policy**: We bump the minimum when we adopt new MCP SDK features (e.g., `streamable_http_client` introduced in 1.24.0). Minimum version bumps are documented in the changelog.
- **Major-version compatibility**: MCP SDK 2.x contains breaking API changes that mcp-use has not migrated to yet. Keep the `<2.0.0` upper bound until 2.x compatibility is implemented and validated, then remove it as part of that migration.
- **Breaking changes**: If a new MCP SDK version introduces breaking changes, we release a new minor version of mcp-use with the updated minimum and document the migration in the changelog.

## Core Dependencies

| Package | Version Constraint | Update Policy |
|---------|-------------------|---------------|
| `mcp` | `>=1.24.0,<2.0.0` | Bump minimum when adopting new features; uncap after the MCP SDK 2.x migration |
| `langchain` | `>=1.0.0` | Follow LangChain major versions |
| `httpx` | `>=0.27.1` | Update for security patches and new features |
| `pydantic` | `>=2.11.0,<3.0.0` | Stay within Pydantic v2; v3 migration will be a major release |
| `websockets` | `>=15.0` | Update for security patches |

## Update Cadence

- **Security patches**: Applied within 7 days of disclosure
- **Minor dependency updates**: Reviewed and applied monthly
- **Major dependency updates**: Evaluated per release cycle, communicated via changelog

## Breaking Dependency Changes

When a dependency update requires user action:

1. The change is documented in the [changelog](https://mcp-use.com/docs/python/changelog/changelog)
2. A migration guide is provided if the change affects the public API
3. The minimum version bump is noted in the release notes

## Reporting Dependency Issues

If you encounter a dependency conflict or vulnerability, please [open an issue](https://github.com/mcp-use/mcp-use/issues/new) with the `dependencies` label.
