# Auth schemes

OpenAPI declares auth in `components.securitySchemes`; each operation references a scheme via the `security` array. Four schemes cover ~95% of real-world APIs. This file shows the spec shape, the env vars to ask for, and how the header is built.

The rule of thumb: never put secrets in the conversation, never commit them, and never bake them into `index.ts`. Everything goes through `process.env` so the same code runs locally and in production.

## 1. API key in a header (most common)

Spec:

```yaml
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
```

Env var: `API_KEY` (or whatever name the user prefers; document it in `.env.example`).

Header built by `src/auth.ts`:

```
X-API-Key: <value of process.env.API_KEY>
```

Notes: if `in: query` or `in: cookie`, the value goes in the URL or cookie jar instead. Query-string keys are insecure (they end up in logs); flag this to the user and ask whether they want to proceed.

## 2. HTTP Bearer (Authorization: Bearer ...)

Spec:

```yaml
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT      # informational only — doesn't change anything
```

Env var: `BEARER_TOKEN`.

Header:

```
Authorization: Bearer <value of process.env.BEARER_TOKEN>
```

This is the default for most modern APIs (GitHub PATs, OpenAI, Anthropic, etc.).

## 3. HTTP Basic (Authorization: Basic base64(user:pass))

Spec:

```yaml
components:
  securitySchemes:
    BasicAuth:
      type: http
      scheme: basic
```

Env vars: `BASIC_USER`, `BASIC_PASS`.

Header:

```
Authorization: Basic <base64(`${BASIC_USER}:${BASIC_PASS}`)>
```

Rare in modern APIs; common in older internal services.

## 4. OAuth2 — pre-issued access token

Spec:

```yaml
components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://example.com/oauth/authorize
          tokenUrl: https://example.com/oauth/token
          scopes:
            read: Read access
            write: Write access
```

For the MCP server, OAuth2 effectively reduces to a bearer token: you obtain an access token out of band and put it in `OAUTH_ACCESS_TOKEN` (or `BEARER_TOKEN`).

Header:

```
Authorization: Bearer <token>
```

If the API needs token refresh:

- The token has a short lifetime (often 1 hour).
- Store the refresh token in `OAUTH_REFRESH_TOKEN`.
- Wrap `callOperation` so that on a 401 the client exchanges the refresh token at `tokenUrl`, updates the in-memory access token, and retries once.

Pattern (add to `src/client.ts` only if the API needs it):

```ts
let cachedToken = process.env.OAUTH_ACCESS_TOKEN;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
  const refresh = process.env.OAUTH_REFRESH_TOKEN;
  const tokenUrl = process.env.OAUTH_TOKEN_URL;
  if (!refresh || !tokenUrl) throw new Error("Missing OAUTH_REFRESH_TOKEN / OAUTH_TOKEN_URL");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: process.env.OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.OAUTH_CLIENT_SECRET ?? "",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const json: any = await res.json();
  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
  return cachedToken!;
}
```

For full OAuth2 with browser-based consent (no pre-issued token), defer to a one-time CLI script that hits `authorizationUrl`, captures the code, exchanges it, and prints the access + refresh tokens. The MCP server itself should stay headless.

## Multiple schemes on one operation

`security: [{ApiKey: [], Bearer: []}]` means **both** must be sent (AND). `security: [{ApiKey: []}, {Bearer: []}]` means **either** (OR). For OR, prefer the scheme the user provided env vars for; fall back to the next one.

If the operation has `security: []` (empty array), it's explicitly unauthenticated — skip the auth header for that call.

## Logging and rotation

Never log header values. In `client.ts`, the `DEBUG_HTTP=1` flag logs URL + body but redacts `Authorization` and any custom auth header. Make the redaction visible (`Authorization: Bearer [REDACTED]`) so debugging stays useful.

Rotate tokens by changing `.env` and restarting the dev server. In production (Manufact / mcp-use cloud), rotate via the env-var settings in the dashboard — no redeploy needed.
