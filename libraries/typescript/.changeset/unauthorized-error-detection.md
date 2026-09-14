---
"@mcp-use/client": patch
---

fix(client): prevent false-positive 401 detection on connection errors and timeouts

- Harden `isUnauthorized` in `auth/flow.ts` to reject POSIX/Node system network errors (e.g., `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`) and avoid false positives on port numbers (`4010-4019`) or duration strings (`401ms`).
- Support structured HTTP response statuses (`status: 401`, `statusCode: 401`, `code: 401`) to eliminate false negatives when servers return custom error messages.
- Delegate `classifyStreamableHttpFailure` in `transport/http.ts` to `isUnauthorized` for unified error classification.
