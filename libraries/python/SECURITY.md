# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.6.x (Python) | ✅ |
| 1.5.x (Python) | Security fixes only |
| < 1.5 (Python) | ❌ |

## Reporting a Vulnerability

If you discover a security vulnerability in mcp-use, please report it through [GitHub's private vulnerability reporting](https://github.com/mcp-use/mcp-use/security/advisories/new). This is our supported and preferred method for receiving security reports.

When reporting, please include:
- Steps to reproduce
- Impact assessment
- Any suggested fixes

We will acknowledge receipt within **2 business days** and provide an initial assessment within **7 days**.

## Response Timeline

| Severity | Response | Fix |
|----------|----------|-----|
| Critical (CVSS ≥ 9.0) | 24 hours | 3 days |
| High (CVSS 7.0–8.9) | 2 business days | 7 days |
| Medium (CVSS 4.0–6.9) | 1 week | Next release |
| Low (CVSS < 4.0) | 2 weeks | Next release |

## Security Practices

- All dependencies are reviewed for known vulnerabilities before release
- OAuth implementation follows [MCP Authorization spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) and OAuth 2.1 best practices
- DNS rebinding protection is available via `dns_rebinding_protection=True`
- Access tokens are never logged or exposed in error messages
