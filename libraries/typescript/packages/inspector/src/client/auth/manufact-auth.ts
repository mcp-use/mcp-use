import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getInspectorBase } from "@/client/utils/basePath";

const SCOPES = "openid profile email offline_access";
const STORAGE_PREFIX = "mcp-inspector:manufact-auth";
const CHANGE_EVENT = "manufact:session-changed";

export interface ManufactUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface OAuthMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
}

interface ClientRegistration {
  client_id: string;
}

interface TokenSet {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_at: number;
}

interface PendingAuthorization {
  authOrigin: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  expiresAt: number;
}

interface ManufactAuthSnapshot {
  loaded: boolean;
  authorizing: boolean;
  accessToken: string | null;
  user: ManufactUser | null;
  mode: "session" | "oauth" | null;
}

const EMPTY_SNAPSHOT: ManufactAuthSnapshot = {
  loaded: true,
  authorizing: false,
  accessToken: null,
  user: null,
  mode: null,
};

const snapshots = new Map<string, ManufactAuthSnapshot>();
const listeners = new Set<() => void>();
const loading = new Map<string, Promise<void>>();
const refreshes = new Map<string, Promise<TokenSet | null>>();

function snapshotFor(origin: string): ManufactAuthSnapshot {
  const existing = snapshots.get(origin);
  if (existing) return existing;
  const initial = { ...EMPTY_SNAPSHOT, loaded: false };
  snapshots.set(origin, initial);
  return initial;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function authOrigin(chatApiUrl: string): string {
  return new URL(chatApiUrl).origin;
}

export function canShareManufactSession(
  inspectorUrl: string,
  cloudOrigin: string
): boolean {
  const inspector = new URL(inspectorUrl);
  const cloud = new URL(cloudOrigin);
  const localHosts = new Set(["localhost", "127.0.0.1"]);
  if (localHosts.has(inspector.hostname) && localHosts.has(cloud.hostname)) {
    // Cookies are port-agnostic on localhost, but inspector dev (:3005) is a
    // separate app from the website/API — use OAuth, not shared-session login.
    return inspector.origin === cloud.origin;
  }
  return (
    (inspector.hostname === "manufact.com" ||
      inspector.hostname.endsWith(".manufact.com")) &&
    (cloud.hostname === "manufact.com" ||
      cloud.hostname.endsWith(".manufact.com"))
  );
}

function sharedAppOrigin(origin: string): string {
  const injected = (window as Window & { __MANUFACT_LOGIN_URL__?: string })
    .__MANUFACT_LOGIN_URL__;
  if (injected) return new URL(injected).origin;
  const url = new URL(origin);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return `${url.protocol}//${url.hostname}:3000`;
  }
  return `${url.protocol}//manufact.com`;
}

function sharedLoginUrl(origin: string): string {
  return `${sharedAppOrigin(origin)}/login`;
}

function sharedSignOutUrl(origin: string): string {
  return `${sharedAppOrigin(origin)}/auth/embedded-sign-out`;
}

function storageKey(
  origin: string,
  kind: "client" | "tokens" | "skip-session"
): string {
  return `${STORAGE_PREFIX}:${kind}:${origin}`;
}

function shouldSkipSharedSession(origin: string): boolean {
  return browserStorage()?.getItem(storageKey(origin, "skip-session")) === "1";
}

function setSkipSharedSession(origin: string, skip: boolean): void {
  const key = storageKey(origin, "skip-session");
  if (skip) browserStorage()?.setItem(key, "1");
  else browserStorage()?.removeItem(key);
}

function stateKey(state: string): string {
  return `${STORAGE_PREFIX}:state:${state}`;
}

function readJson<T>(key: string): T | null {
  const raw = browserStorage()?.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    browserStorage()?.removeItem(key);
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  browserStorage()?.setItem(key, JSON.stringify(value));
}

function emit(origin: string, patch: Partial<ManufactAuthSnapshot>): void {
  snapshots.set(origin, {
    ...(snapshots.get(origin) ?? EMPTY_SNAPSHOT),
    ...patch,
  });
  listeners.forEach((listener) => listener());
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomValue(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64Url(new Uint8Array(digest));
}

async function discover(origin: string): Promise<OAuthMetadata> {
  const response = await fetch(
    `${origin}/api/auth/.well-known/openid-configuration`
  );
  if (!response.ok) throw new Error("Manufact OAuth discovery failed");
  return (await response.json()) as OAuthMetadata;
}

function callbackUri(): string {
  return `${window.location.origin}${getInspectorBase()}/auth/callback`;
}

async function getClient(
  origin: string,
  metadata: OAuthMetadata
): Promise<ClientRegistration> {
  const redirectUri = callbackUri();
  const key = storageKey(origin, "client");
  const stored = readJson<ClientRegistration & { redirect_uri?: string }>(key);
  if (stored?.client_id && stored.redirect_uri === redirectUri) return stored;
  if (!metadata.registration_endpoint) {
    throw new Error("Manufact OAuth registration is unavailable");
  }

  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "mcp-use Inspector",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPES,
    }),
  });
  if (!response.ok)
    throw new Error("Could not register Inspector with Manufact");
  const client = (await response.json()) as ClientRegistration;
  if (!client.client_id)
    throw new Error("Manufact returned no OAuth client ID");
  const persisted = { ...client, redirect_uri: redirectUri };
  writeJson(key, persisted);
  // ponytail: browser/origin caching can leave stale DCR rows after storage is
  // cleared; use provisioned static clients plus cleanup if row growth matters.
  return persisted;
}

async function exchangeToken(
  tokenEndpoint: string,
  body: Record<string, string>
): Promise<TokenSet> {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ?? "Manufact token exchange failed"
    );
  }
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type,
    expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
}

async function refresh(
  origin: string,
  tokens: TokenSet
): Promise<TokenSet | null> {
  if (!tokens.refresh_token) return null;
  const existing = refreshes.get(origin);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const metadata = await discover(origin);
      const client = readJson<ClientRegistration>(storageKey(origin, "client"));
      if (!client?.client_id) return null;
      const next = await exchangeToken(metadata.token_endpoint, {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token!,
        client_id: client.client_id,
      });
      const merged = {
        ...next,
        refresh_token: next.refresh_token ?? tokens.refresh_token,
      };
      writeJson(storageKey(origin, "tokens"), merged);
      return merged;
    } catch {
      browserStorage()?.removeItem(storageKey(origin, "tokens"));
      return null;
    } finally {
      refreshes.delete(origin);
    }
  })();
  refreshes.set(origin, promise);
  return promise;
}

async function validTokens(origin: string): Promise<TokenSet | null> {
  const tokens = readJson<TokenSet>(storageKey(origin, "tokens"));
  if (!tokens?.access_token) return null;
  if (tokens.expires_at > Date.now() + 30_000) return tokens;
  return refresh(origin, tokens);
}

async function fetchUser(
  origin: string,
  accessToken: string
): Promise<ManufactUser | null> {
  const metadata = await discover(origin);
  if (!metadata.userinfo_endpoint) return null;
  const response = await fetch(metadata.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    sub?: string;
    name?: string | null;
    email?: string | null;
    picture?: string | null;
  };
  if (!data.sub) return null;
  return {
    id: data.sub,
    name: data.name,
    email: data.email,
    image: data.picture,
  };
}

async function fetchSessionUser(origin: string): Promise<ManufactUser | null> {
  try {
    const response = await fetch(`${origin}/api/auth/get-session`, {
      credentials: "include",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      user?: ManufactUser | null;
    } | null;
    const user = data?.user ?? null;
    return user;
  } catch {
    return null;
  }
}

export function getSharedManufactSession(
  chatApiUrl: string
): Promise<ManufactUser | null> {
  return fetchSessionUser(authOrigin(chatApiUrl));
}

async function load(origin: string): Promise<void> {
  const existing = loading.get(origin);
  if (existing) {
    return existing;
  }
  snapshots.set(origin, {
    ...(snapshots.get(origin) ?? EMPTY_SNAPSHOT),
    loaded: false,
  });
  const promise = (async () => {
    try {
      const inspectorUrl =
        typeof window !== "undefined" ? window.location.href : origin;
      const shareSession = canShareManufactSession(inspectorUrl, origin);
      const skipSession = shouldSkipSharedSession(origin);
      const tokens = await validTokens(origin);
      const oauthUser = tokens
        ? await fetchUser(origin, tokens.access_token)
        : null;
      if (oauthUser && tokens) {
        setSkipSharedSession(origin, false);
        emit(origin, {
          loaded: true,
          accessToken: tokens.access_token,
          user: oauthUser,
          mode: "oauth",
        });
        return;
      }
      if (tokens && !oauthUser) {
        browserStorage()?.removeItem(storageKey(origin, "tokens"));
      }
      const sessionUser =
        shareSession && !skipSession ? await fetchSessionUser(origin) : null;
      if (sessionUser) {
        emit(origin, {
          loaded: true,
          accessToken: null,
          user: sessionUser,
          mode: "session",
        });
        return;
      }
      emit(origin, {
        loaded: true,
        accessToken: null,
        user: null,
        mode: null,
      });
    } catch {
      emit(origin, {
        loaded: true,
        accessToken: null,
        user: null,
        mode: null,
      });
    }
  })().finally(() => loading.delete(origin));
  loading.set(origin, promise);
  return promise;
}

export async function authorizeManufact(chatApiUrl: string): Promise<void> {
  const origin = authOrigin(chatApiUrl);
  setSkipSharedSession(origin, false);
  const popup = window.open(
    "",
    "manufact-oauth",
    "width=600,height=700,resizable=yes,scrollbars=yes"
  );
  if (!popup) throw new Error("Allow popups to sign in with Manufact");
  emit(origin, { authorizing: true });
  if (canShareManufactSession(window.location.href, origin)) {
    popup.location.href = sharedLoginUrl(origin);
    const sessionPoll = window.setInterval(async () => {
      if (popup.closed) {
        window.clearInterval(sessionPoll);
        emit(origin, { authorizing: false });
        return;
      }
      const user = await fetchSessionUser(origin);
      if (!user) return;
      window.clearInterval(sessionPoll);
      popup.close();
      emit(origin, {
        loaded: true,
        authorizing: false,
        accessToken: null,
        user,
        mode: "session",
      });
    }, 1000);
    return;
  }
  try {
    const metadata = await discover(origin);
    const client = await getClient(origin, metadata);
    const verifier = randomValue(64);
    const state = randomValue();
    const redirectUri = callbackUri();
    writeJson(stateKey(state), {
      authOrigin: origin,
      clientId: client.client_id,
      redirectUri,
      codeVerifier: verifier,
      expiresAt: Date.now() + 10 * 60 * 1000,
    } satisfies PendingAuthorization);
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.client_id);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", await codeChallenge(verifier));
    url.searchParams.set("code_challenge_method", "S256");
    // Inspector is a third-party OAuth client — always require explicit consent.
    // (Different dev ports do not imply consent; OAuth consent is per client grant.)
    url.searchParams.set("prompt", "consent");
    popup.location.href = url.toString();
    const closePoll = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(closePoll);
      // ponytail: cross-origin OAuth redirects often null window.opener, so
      // postMessage from the callback is unreliable — reload when popup closes.
      void load(origin).finally(() => emit(origin, { authorizing: false }));
    }, 500);
  } catch (error) {
    popup.close();
    emit(origin, { authorizing: false });
    throw error;
  }
}

export async function completeManufactAuthorization(
  url = new URL(window.location.href)
): Promise<void> {
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (oauthError) throw new Error(oauthError);
  if (!state || !code) throw new Error("Missing OAuth code or state");
  const key = stateKey(state);
  const pending = readJson<PendingAuthorization>(key);
  browserStorage()?.removeItem(key);
  if (!pending || pending.expiresAt < Date.now()) {
    throw new Error("OAuth state is invalid or expired");
  }
  const metadata = await discover(pending.authOrigin);
  const tokens = await exchangeToken(metadata.token_endpoint, {
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirectUri,
    client_id: pending.clientId,
    code_verifier: pending.codeVerifier,
  });
  writeJson(storageKey(pending.authOrigin, "tokens"), tokens);
  setSkipSharedSession(pending.authOrigin, false);
  const user = await fetchUser(pending.authOrigin, tokens.access_token);
  emit(pending.authOrigin, {
    loaded: true,
    authorizing: false,
    accessToken: tokens.access_token,
    user,
    mode: "oauth",
  });
  window.opener?.postMessage(
    { type: "manufact:oauth-complete", authOrigin: pending.authOrigin },
    window.location.origin
  );
}

function clearManufactAuthorization(chatApiUrl: string): void {
  const origin = authOrigin(chatApiUrl);
  browserStorage()?.removeItem(storageKey(origin, "tokens"));
  emit(origin, {
    loaded: true,
    authorizing: false,
    accessToken: null,
    user: null,
    mode: null,
  });
}

async function revokeOAuthTokens(origin: string): Promise<number | null> {
  const tokens = readJson<TokenSet>(storageKey(origin, "tokens"));
  const client = readJson<ClientRegistration>(storageKey(origin, "client"));
  const token = tokens?.refresh_token ?? tokens?.access_token;
  if (!client?.client_id || !token) return null;
  try {
    const metadata = await discover(origin);
    const revokeUrl =
      metadata.revocation_endpoint ?? `${origin}/api/auth/oauth2/revoke`;
    const response = await fetch(revokeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.client_id,
        token,
        token_type_hint: tokens?.refresh_token
          ? "refresh_token"
          : "access_token",
      }),
    });
    return response.status;
  } catch {
    return -1;
  }
}

async function signOutSharedSession(origin: string): Promise<{
  attempted: boolean;
  signOutOk: boolean;
  signOutStatus: number | null;
}> {
  const appOrigin = sharedAppOrigin(origin);
  const popup = window.open(
    sharedSignOutUrl(origin),
    "manufact-sign-out",
    "width=420,height=320"
  );
  if (!popup) {
    return { attempted: true, signOutOk: false, signOutStatus: null };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: {
      attempted: boolean;
      signOutOk: boolean;
      signOutStatus: number | null;
    }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const timeout = window.setTimeout(() => {
      finish({ attempted: true, signOutOk: false, signOutStatus: null });
    }, 30_000);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== appOrigin) return;
      if (event.data?.type !== "manufact:sign-out-complete") return;
      finish({ attempted: true, signOutOk: true, signOutStatus: 200 });
    };
    const poll = window.setInterval(() => {
      if (!popup.closed) return;
      void fetchSessionUser(origin).then((user) => {
        finish({
          attempted: true,
          signOutOk: !user,
          signOutStatus: user ? 401 : 200,
        });
      });
    }, 500);
    window.addEventListener("message", onMessage);
  });
}

export async function logoutManufact(
  chatApiUrl: string,
  mode: ManufactAuthSnapshot["mode"]
): Promise<void> {
  const origin = authOrigin(chatApiUrl);
  const hadTokens = !!readJson<TokenSet>(storageKey(origin, "tokens"))
    ?.access_token;
  if (mode === "oauth" || hadTokens) {
    await revokeOAuthTokens(origin);
    setSkipSharedSession(origin, true);
  } else if (mode === "session") {
    await signOutSharedSession(origin);
    setSkipSharedSession(origin, false);
  }
  clearManufactAuthorization(chatApiUrl);
}

export async function getManufactAccessToken(
  chatApiUrl: string
): Promise<string | null> {
  const origin = authOrigin(chatApiUrl);
  const tokens = await validTokens(origin);
  return tokens?.access_token ?? null;
}

export function useManufactAuth(chatApiUrl: string | null | undefined): {
  loaded: boolean;
  authorizing: boolean;
  accessToken: string | null;
  user: ManufactUser | null;
  mode: "session" | "oauth" | null;
  authorize: () => Promise<void>;
  logout: () => Promise<void>;
} {
  const origin = chatApiUrl ? authOrigin(chatApiUrl) : null;
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  const getSnapshot = useCallback(
    () => (origin ? snapshotFor(origin) : EMPTY_SNAPSHOT),
    [origin]
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_SNAPSHOT
  );

  useEffect(() => {
    if (!origin) return;
    void load(origin);
    const onComplete = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === "manufact:oauth-complete" &&
        event.data.authOrigin === origin
      ) {
        void load(origin).finally(() => emit(origin, { authorizing: false }));
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey(origin, "tokens") || !event.newValue) return;
      void load(origin).finally(() => emit(origin, { authorizing: false }));
    };
    window.addEventListener("message", onComplete);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("message", onComplete);
      window.removeEventListener("storage", onStorage);
    };
  }, [origin]);

  return {
    ...snapshot,
    authorize: useCallback(async () => {
      if (chatApiUrl) await authorizeManufact(chatApiUrl);
    }, [chatApiUrl]),
    logout: useCallback(async () => {
      if (chatApiUrl) await logoutManufact(chatApiUrl, snapshot.mode);
    }, [chatApiUrl, snapshot.mode]),
  };
}
