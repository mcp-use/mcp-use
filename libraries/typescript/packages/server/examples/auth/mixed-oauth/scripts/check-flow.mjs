// Checks the whole mixed-auth flow against a running mixed-oauth example
// without a host: dynamic registration, sign-in, consent (full and partial),
// token exchange, then every item signed out, signed in, after a scope
// step-up, and with a declined scope.
//
// Usage: pnpm check-flow [origin]   (default: MCP_URL or http://localhost:3000)
import { createHash, randomBytes } from "node:crypto";

const origin =
  process.argv[2] ?? process.env["MCP_URL"] ?? "http://localhost:3000";
const mcp = new URL("/mcp", origin).href;
const redirectUri = "http://localhost:9/callback";
const jar = new Map();
let failures = 0;

function cookieHeader() {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}
function remember(response) {
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}
async function browserFetch(url, init = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    ...init,
    headers: { cookie: cookieHeader(), origin, ...(init.headers ?? {}) },
  });
  remember(response);
  return response;
}

function check(label, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(
    `${condition ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`
  );
}

const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
async function rpc(method, params = {}, token) {
  const name = params.name ?? params.uri;
  const response = await fetch(mcp, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(typeof name === "string" && { "mcp-name": name }),
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: ENVELOPE },
    }),
  });
  const challenge = response.headers.get("www-authenticate");
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const result = body?.result;
  const text =
    result?.content?.[0]?.text ??
    result?.contents?.[0]?.text ??
    result?.messages?.[0]?.content?.text;
  return { status: response.status, challenge, body, text };
}
const scopeOf = (challenge) => /scope="([^"]*)"/.exec(challenge ?? "")?.[1];
const errorOf = (challenge) => /error="([^"]*)"/.exec(challenge ?? "")?.[1];

// --- discovery + registration ---------------------------------------------
const prm = await (
  await fetch(new URL("/.well-known/oauth-protected-resource/mcp", origin))
).json();
const asUrl = prm.authorization_servers[0];
const as = await (
  await fetch(
    new URL(
      `/.well-known/oauth-authorization-server${new URL(asUrl).pathname}`,
      origin
    )
  )
).json();
check(
  "protected-resource metadata advertises the AS",
  typeof as.authorization_endpoint === "string"
);

const registration = await (
  await browserFetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "e2e",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "demo:protected", // a host registering with the first challenge only
    }),
  })
).json();
check(
  "registration grants every demo scope regardless of the requested one",
  typeof registration.scope === "string" &&
    registration.scope.includes("profile"),
  registration.scope
);
const clientId = registration.client_id;

async function authorize(scope, grant) {
  const verifier = randomBytes(32).toString("base64url");
  const challengeValue = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const url = new URL(as.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challengeValue,
    code_challenge_method: "S256",
    state: randomBytes(8).toString("hex"),
    resource: mcp,
    ...(scope !== undefined && { scope }),
  }).toString();
  let next = url.href;
  for (let hop = 0; hop < 12; hop += 1) {
    if (next.startsWith(redirectUri)) {
      const code = new URL(next).searchParams.get("code");
      if (!code) throw new Error(`no code: ${next}`);
      const token = await (
        await fetch(as.token_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier,
            resource: mcp,
          }),
        })
      ).json();
      if (!token.access_token)
        throw new Error(`token error: ${JSON.stringify(token)}`);
      return token;
    }
    const target = new URL(next, origin);
    const oauthQuery = target.search.slice(1);
    if (target.pathname === "/sign-in") {
      const data = await (
        await browserFetch(new URL("/api/auth/sign-in/anonymous", origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ oauth_query: oauthQuery }),
        })
      ).json();
      next = data.url;
      continue;
    }
    if (target.pathname === "/consent") {
      const data = await (
        await browserFetch(new URL("/api/auth/oauth2/consent", origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accept: true,
            ...(grant && { scope: grant }),
            oauth_query: oauthQuery,
          }),
        })
      ).json();
      next = data.url;
      continue;
    }
    const response = await browserFetch(target.href, {
      headers: { accept: "text/html" },
    });
    const location = response.headers.get("location");
    if (location) {
      next = new URL(location, target).href;
      continue;
    }
    // Better Auth answers fetch-style requests with { url } instead of a 302.
    const data = await response.json().catch(() => undefined);
    if (typeof data?.url !== "string")
      throw new Error(`stuck at ${target.href}: ${response.status}`);
    next = new URL(data.url, target).href;
  }
  throw new Error("too many hops");
}

function tokenScopes(accessToken) {
  const payload = JSON.parse(
    Buffer.from(accessToken.split(".")[1], "base64url").toString()
  );
  return payload.scope ?? "";
}

const call = (name, token) => rpc("tools/call", { name, arguments: {} }, token);
const read = (uri, token) => rpc("resources/read", { uri }, token);
const getPrompt = (name, token) => rpc("prompts/get", { name }, token);

// --- signed out -------------------------------------------------------------
const list = await rpc("tools/list");
const tools = new Map(list.body.result.tools.map((tool) => [tool.name, tool]));
// The server's REQUIRED_SCOPES, read from the scheme of a tool that omits
// securitySchemes.
const baseline = tools
  .get("protected_profile")
  .securitySchemes[0].scopes.join(" ");
console.log(`\n== signed out (required scopes: ${baseline || "none"}) ==`);
for (const [name, tool] of tools) {
  console.log(`  ${name}: ${JSON.stringify(tool.securitySchemes)}`);
}
for (const name of [
  "public_ping",
  "optional_whoami",
  "optional_welcome",
  "public_card",
]) {
  const r = await call(name);
  check(
    `${name} runs signed out`,
    r.status === 200 && /signed out|generic/.test(r.text ?? ""),
    r.text
  );
}
for (const [name, scopes] of [
  ["protected_profile", baseline],
  ["protected_update_profile", [baseline, "profile"].filter(Boolean).join(" ")],
  ["protected_card", baseline],
]) {
  const r = await call(name);
  check(
    `${name} signed out -> 401`,
    r.status === 401 && (scopeOf(r.challenge) ?? "") === scopes,
    `scope="${scopeOf(r.challenge) ?? ""}"`
  );
}
// Resources, views included, and prompts always need sign-in.
for (const uri of [
  "demo://protected/profile",
  "demo://protected/notes/7",
  "ui://views/public-card.html",
  "ui://views/protected-card.html",
]) {
  const r = await read(uri);
  check(`read ${uri} signed out -> 401`, r.status === 401, `${r.status}`);
}
{
  const r = await getPrompt("protected_summary");
  check(
    "prompt protected_summary signed out -> 401",
    r.status === 401,
    `${r.status}`
  );
}

// --- signed in with the first challenge's scopes ---------------------------
console.log("\n== signed in with the baseline only ==");
const first = await authorize(baseline || undefined, baseline || "openid");
console.log("token scope claim:", tokenScopes(first.access_token));
let r = await call("protected_profile", first.access_token);
check(
  "protected_profile runs",
  r.status === 200 && /signed in as/.test(r.text ?? ""),
  r.text
);
r = await call("optional_whoami", first.access_token);
check(
  "optional_whoami sees the identity",
  /signed in as/.test(r.text ?? ""),
  r.text
);
r = await call("optional_welcome", first.access_token);
check(
  "optional_welcome without profile falls back (not refused)",
  r.status === 200 && /generic/.test(r.text ?? ""),
  r.text
);
r = await call("protected_update_profile", first.access_token);
check(
  "protected_update_profile -> 403 insufficient_scope with the full set",
  r.status === 403 &&
    errorOf(r.challenge) === "insufficient_scope" &&
    scopeOf(r.challenge) === [baseline, "profile"].filter(Boolean).join(" "),
  r.challenge
);
r = await read("demo://protected/notes/1", first.access_token);
check(
  "protected note readable with the baseline",
  r.status === 200 && /signed in as/.test(r.text ?? ""),
  r.text
);
for (const view of ["public-card", "protected-card"]) {
  r = await read(`ui://views/${view}.html`, first.access_token);
  check(
    `${view} view readable with the baseline`,
    r.status === 200,
    `${r.status}`
  );
}
r = await getPrompt("protected_summary", first.access_token);
check(
  "protected_summary prompt runs",
  r.status === 200 && /signed in as/.test(r.text ?? ""),
  r.text
);

// --- scope step-up ----------------------------------------------------------
console.log("\n== step-up to the challenge's full scope set ==");
const upgraded = await authorize(
  [baseline, "profile", "email"].filter(Boolean).join(" ")
);
console.log("token scope claim:", tokenScopes(upgraded.access_token));
r = await call("protected_update_profile", upgraded.access_token);
check("protected_update_profile runs after step-up", r.status === 200, r.text);
r = await call("optional_welcome", upgraded.access_token);
check(
  "optional_welcome personalizes with profile",
  /welcome back/.test(r.text ?? ""),
  r.text
);

// --- declined scope on the consent screen ----------------------------------
console.log(
  "\n== profile declined on consent (fresh user; Better Auth remembers earlier consent) =="
);
jar.clear();
const declined = await authorize(
  `${baseline || "openid"} profile`,
  baseline || "openid"
);
console.log("token scope claim:", tokenScopes(declined.access_token));
r = await call("optional_welcome", declined.access_token);
check(
  "optional_welcome falls back when profile was declined",
  r.status === 200 && /generic/.test(r.text ?? ""),
  r.text
);

// --- bad tokens and ChatGPT format -----------------------------------------
console.log("\n== bad token and ChatGPT format ==");
r = await call("public_ping", "not-a-jwt");
check("invalid token on a public tool -> 401", r.status === 401, r.challenge);
const chatgpt = await fetch(mcp, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": "ChatGPT/1.0",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "tools/call",
    "mcp-name": "protected_update_profile",
    authorization: `Bearer ${first.access_token}`,
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: {
      name: "protected_update_profile",
      arguments: {},
      _meta: ENVELOPE,
    },
  }),
});
const chatgptBody = await chatgpt.json();
check(
  "ChatGPT step-up is an in-band insufficient_scope result",
  chatgpt.status === 200 &&
    chatgptBody.result?.isError === true &&
    /insufficient_scope/.test(
      chatgptBody.result?._meta?.["mcp/www_authenticate"]?.[0] ?? ""
    ),
  chatgptBody.result?._meta?.["mcp/www_authenticate"]?.[0]
);

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
