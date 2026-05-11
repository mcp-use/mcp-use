import {
  formatError,
  formatInfo,
  formatKeyValue,
  formatSuccess,
} from "../utils/format.js";
import { buildOAuthProvider } from "../utils/oauth.js";
import { getActiveSession, getSession } from "../utils/session-storage.js";

async function resolveSession(
  sessionArg: string | undefined
): Promise<{ name: string; url: string } | null> {
  let name = sessionArg;
  if (!name) {
    const active = await getActiveSession();
    if (!active) {
      console.error(formatError("No active session"));
      return null;
    }
    name = active.name;
  }
  const config = await getSession(name);
  if (!config) {
    console.error(formatError(`Session '${name}' not found`));
    return null;
  }
  if (config.type !== "http") {
    console.error(formatError("Auth commands only apply to HTTP sessions"));
    return null;
  }
  if (config.authMode !== "oauth") {
    console.error(
      formatError(
        `Session '${name}' was not authenticated via OAuth (authMode=${config.authMode ?? "bearer"})`
      )
    );
    return null;
  }
  return { name, url: config.url! };
}

function formatExpiresIn(expSec: number): string {
  const ms = expSec * 1000 - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h${rem}m` : `${hours}h`;
}

function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export async function authStatusCommand(sessionArg?: string): Promise<void> {
  const target = await resolveSession(sessionArg);
  if (!target) {
    process.exit(1);
  }
  const provider = await buildOAuthProvider(target.url);
  const tokens = await provider.tokens();

  const fields: Record<string, string> = {
    session: target.name,
    url: target.url,
    tokens: tokens?.access_token ? "present" : "missing",
  };
  if (tokens?.scope) fields.scope = tokens.scope;
  if (tokens?.access_token) {
    const exp = decodeJwtExp(tokens.access_token);
    fields.expires_in = exp ? formatExpiresIn(exp) : "unknown (opaque token)";
  }
  fields.refresh = tokens?.refresh_token ? "available" : "missing";

  console.log(formatKeyValue(fields));

  if (!tokens?.access_token) process.exit(1);
}

export async function authRefreshCommand(sessionArg?: string): Promise<void> {
  const target = await resolveSession(sessionArg);
  if (!target) {
    process.exit(1);
  }
  const provider = await buildOAuthProvider(target.url);
  const refreshed = await provider.forceRefresh();
  if (!refreshed) {
    console.error(
      formatError(
        "Refresh failed (no refresh_token, or server rejected). Re-connect to re-authenticate."
      )
    );
    console.error(
      formatInfo(
        `Run: mcp-use client connect ${target.url} --name ${target.name}`
      )
    );
    process.exit(1);
  }
  const exp = refreshed.access_token
    ? decodeJwtExp(refreshed.access_token)
    : null;
  console.log(
    formatSuccess(
      `Refreshed access token${exp ? ` (expires in ${formatExpiresIn(exp)})` : ""}`
    )
  );
}

export async function authLogoutCommand(sessionArg?: string): Promise<void> {
  const target = await resolveSession(sessionArg);
  if (!target) {
    process.exit(1);
  }
  const provider = await buildOAuthProvider(target.url);
  await provider.invalidateCredentials("all");
  console.log(formatSuccess(`Removed tokens for ${target.url}`));
  console.log(
    formatInfo(
      `Session '${target.name}' kept; reconnect with \`mcp-use client connect\`.`
    )
  );
}
