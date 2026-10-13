import {
  createLocalJWKSet,
  errors,
  jwtVerify,
  UnsecuredJWT,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyOptions,
} from "jose";

import { isBuilding } from "../../build-phase.js";
import { isLocalhost, isRecord } from "../guards.js";
import { escapeHtml } from "./consent.js";
import {
  printable,
  UpstreamError,
  UpstreamRefreshError,
  type InPageUpstream,
  type UpstreamTokenSet,
  type UpstreamUser,
} from "./upstream.js";

/** Firebase JS SDK version that the sign-in page loads from gstatic. */
const SDK_VERSION = "12.19.0";
const SDK_URL = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
/**
 * Public keys of Firebase ID tokens as a JWK set: the `jwks_uri` of
 * `https://securetoken.google.com/<project>/.well-known/openid-configuration`.
 */
const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
/** The page posts an ID token and a refresh token; both are a few KB. */
const MAX_PROOF_LENGTH = 16 * 1024;
/** Seconds to wait before fetching the keys again for an unknown key id. */
const KEY_REFETCH_COOLDOWN = 30;
/**
 * Token Service errors that end the refresh token for good: the user was
 * deleted or disabled, changed their password or email, or their tokens
 * were revoked.
 */
const REVOKED_CODES = new Set([
  "TOKEN_EXPIRED",
  "USER_DISABLED",
  "USER_NOT_FOUND",
  "INVALID_REFRESH_TOKEN",
]);
/** `sign_in_provider` values that no popup can produce. */
const NON_POPUP_PROVIDERS = new Set([
  "password",
  "phone",
  "anonymous",
  "custom",
  "emailLink",
]);

/** Options for {@link firebase}. */
export interface FirebaseUpstreamOptions {
  /**
   * Web API key of the Firebase project, from Project settings. It is not a
   * secret: the sign-in page sends it to the browser. The server also uses
   * it to refresh ID tokens, so a key with API restrictions must allow the
   * Token Service API, and must not be limited to HTTP referrers.
   */
  apiKey: string;
  /**
   * Auth domain of the project, for example `my-app.firebaseapp.com`. The
   * sign-in window opens there. Add the MCP server's host to the authorized
   * domains of Firebase Authentication.
   */
  authDomain: string;
  /** Project ID. ID tokens must name it as their audience. */
  projectId: string;
  /**
   * Firebase sign-in providers that users can sign in with in a popup, for
   * example `"google.com"`, `"github.com"`, `"microsoft.com"`, or
   * `"oidc.<provider id>"`. The Allow button uses the first one; a custom
   * consent page can offer more Allow buttons with a `data-provider`
   * attribute. ID tokens from any other provider are refused.
   *
   * @defaultValue `["google.com"]`
   */
  providers?: readonly string[];
  /**
   * Refuse users whose email address is not verified. Set it when your
   * code trusts the `email` in the user's profile.
   *
   * @defaultValue `false`
   */
  requireVerifiedEmail?: boolean;
  /**
   * Seconds after the user's sign-in at Firebase within which the proxy
   * accepts their ID token. Any app of the project can obtain a valid ID
   * token, and popup sign-in has no nonce, so the proxy accepts only a
   * sign-in that just happened.
   *
   * @defaultValue `300`
   */
  maxAuthAge?: number;
  /**
   * Identity Platform tenant ID. When set, only users of this tenant sign
   * in. When unset, users of any tenant are refused.
   */
  tenantId?: string;
  /**
   * Firebase Auth emulator, for local development and tests. The emulator
   * issues ID tokens that are not signed, and the proxy accepts them, so
   * anyone who can reach the MCP server can sign in as any user. `oauthProxy`
   * therefore refuses to run unless the resource URL is on localhost and,
   * under `server.listen()`, the server binds `127.0.0.1`, `localhost`, or
   * `::1`. When a framework or `mcp-use dev` serves `server.fetch`, the
   * server cannot see the bind address: serve it on a loopback address
   * only, with no tunnel. It is never read from `FIREBASE_AUTH_EMULATOR_HOST`.
   */
  emulator?: {
    /**
     * URL of the emulator on a loopback address, for example
     * `http://127.0.0.1:9099`.
     */
    url: string;
  };
}

/**
 * Creates a Firebase Authentication upstream for `oauthProxy`.
 *
 * Firebase has no OAuth authorization endpoint, so the user signs in on the
 * proxy's consent page: clicking Allow opens the provider's sign-in window
 * with the Firebase JS SDK (loaded from `www.gstatic.com`, version
 * 12.19.0), and the page posts the user's ID token and refresh token with
 * the decision. The proxy checks the ID token's signature, project,
 * provider, and sign-in time, keeps both tokens on the server, and refreshes
 * the ID token with the Token Service API before it expires.
 *
 * The user's subject is the Firebase uid, and the profile holds `uid`,
 * `email`, `email_verified`, `name`, `picture`, and `sign_in_provider`.
 * Tools read the user's Firebase ID token with `upstreamToken(ctx)`, for
 * example to call Firestore as that user.
 *
 * In the Firebase console, enable the providers and add the MCP server's
 * host to the authorized domains of Authentication. The project's own OAuth
 * apps are used: the proxy needs no client secret.
 *
 * @param options - Project settings, providers, and checks.
 * @returns An upstream for `oauthProxy`.
 * @throws A `TypeError` if an option is invalid.
 *
 * @example
 * ```ts
 * import { firebase, oauthProxy } from "mcp-use/oauth";
 *
 * const oauth = oauthProxy({
 *   upstream: firebase({
 *     apiKey: process.env.MCP_USE_FIREBASE_API_KEY!,
 *     authDomain: process.env.MCP_USE_FIREBASE_AUTH_DOMAIN!,
 *     projectId: process.env.MCP_USE_FIREBASE_PROJECT_ID!,
 *     providers: ["google.com"],
 *   }),
 * });
 * ```
 */
export function firebase(options: FirebaseUpstreamOptions): InPageUpstream {
  if (options === null || typeof options !== "object") {
    throw new TypeError("firebase() requires options");
  }
  // `mcp-use build` runs the entry without serving requests, so it needs
  // no project settings.
  const building = isBuilding();
  for (const field of ["apiKey", "authDomain", "projectId"] as const) {
    const value: unknown = options[field];
    if (
      typeof value !== "string" ||
      (value.length === 0 && !building) ||
      /\s/.test(value)
    ) {
      throw new TypeError(`firebase ${field} must be a non-empty string`);
    }
  }
  if (
    options.authDomain !== "" &&
    !/^[a-z0-9.-]+(?::\d+)?$/i.test(options.authDomain)
  ) {
    throw new TypeError(
      "firebase authDomain must be a host name such as my-app.firebaseapp.com, without https://"
    );
  }
  const listed: unknown = options.providers ?? ["google.com"];
  if (
    !Array.isArray(listed) ||
    listed.length === 0 ||
    !listed.every(
      (provider: unknown): provider is string =>
        typeof provider === "string" && /^[A-Za-z0-9._-]+$/.test(provider)
    )
  ) {
    throw new TypeError(
      'firebase providers must be a non-empty array of provider IDs such as "google.com"'
    );
  }
  const providers: string[] = [...listed];
  for (const provider of providers) {
    if (NON_POPUP_PROVIDERS.has(provider)) {
      throw new TypeError(
        `firebase provider ${provider} has no sign-in popup; use providers such as "google.com" or "github.com"`
      );
    }
  }
  const maxAuthAge = options.maxAuthAge ?? 300;
  if (!Number.isInteger(maxAuthAge) || maxAuthAge < 10 || maxAuthAge > 86_400) {
    throw new TypeError(
      "firebase maxAuthAge must be an integer from 10 to 86400 seconds"
    );
  }
  if (
    options.requireVerifiedEmail !== undefined &&
    typeof options.requireVerifiedEmail !== "boolean"
  ) {
    throw new TypeError("firebase requireVerifiedEmail must be a boolean");
  }
  if (
    options.tenantId !== undefined &&
    (typeof options.tenantId !== "string" || options.tenantId === "")
  ) {
    throw new TypeError("firebase tenantId must be a non-empty string");
  }
  const emulator =
    options.emulator === undefined
      ? undefined
      : emulatorOrigin(options.emulator);

  const settings: VerifySettings = {
    projectId: options.projectId,
    providers,
    maxAuthAge,
    requireVerifiedEmail: options.requireVerifiedEmail === true,
    tenantId: options.tenantId,
    emulator: emulator !== undefined,
  };
  const keys = signingKeys();
  const pageConfig = {
    app: {
      apiKey: options.apiKey,
      authDomain: options.authDomain,
      projectId: options.projectId,
    },
    providers,
    ...(options.tenantId !== undefined && { tenantId: options.tenantId }),
    ...(emulator !== undefined && { emulator }),
  };
  const refreshBase =
    emulator === undefined
      ? "https://securetoken.googleapis.com"
      : `${emulator}/securetoken.googleapis.com`;

  return {
    kind: "in-page",
    id: "firebase",
    name: "Firebase",
    ...(emulator !== undefined && { emulator: true }),
    csp: {
      script: ["https://www.gstatic.com", "https://apis.google.com"],
      connect: [
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
        ...(emulator === undefined ? [] : [emulator]),
      ],
      frame: [
        `https://${options.authDomain}`,
        ...(emulator === undefined ? [] : [emulator]),
      ],
    },
    script: (nonce) =>
      `<script type="module" nonce="${escapeHtml(nonce)}">${pageScript(
        scriptJson(pageConfig)
      )}</script>`,
    verify: (proof, { fetch }) => verifyProof(proof, settings, keys, fetch),
    refresh: (tokens, { fetch }) =>
      refreshIdToken(tokens, refreshBase, options.apiKey, fetch),
  };
}

/** Validates the emulator URL and returns its origin. */
function emulatorOrigin(emulator: { url: string }): string {
  let url: URL;
  try {
    url = new URL(String(emulator?.url));
  } catch {
    throw new TypeError(
      "firebase emulator.url must be an absolute URL such as http://127.0.0.1:9099"
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError(
      "firebase emulator.url must be an origin such as http://127.0.0.1:9099"
    );
  }
  // The emulator signs nothing: it must be this machine's.
  if (!isLocalhost(url)) {
    throw new TypeError("firebase emulator must run on a loopback address");
  }
  return url.origin;
}

interface VerifySettings {
  projectId: string;
  providers: readonly string[];
  maxAuthAge: number;
  requireVerifiedEmail: boolean;
  tenantId: string | undefined;
  emulator: boolean;
}

/** A refused sign-in. Its reason goes to the log and to the client. */
function refuse(reason: string): UpstreamError {
  return new UpstreamError(
    "access_denied",
    `Firebase ID token refused: ${reason}`,
    false,
    { description: reason }
  );
}

async function verifyProof(
  proof: string,
  settings: VerifySettings,
  keys: SigningKeys,
  fetchImpl: typeof globalThis.fetch
): Promise<{ user: UpstreamUser; tokens: UpstreamTokenSet }> {
  if (typeof proof !== "string" || proof === "") {
    throw refuse("the page sent no Firebase sign-in");
  }
  if (proof.length > MAX_PROOF_LENGTH) {
    throw refuse("the sign-in proof is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(proof);
  } catch {
    throw refuse("the sign-in proof is not JSON");
  }
  if (
    !isRecord(parsed) ||
    typeof parsed["idToken"] !== "string" ||
    parsed["idToken"] === "" ||
    (parsed["refreshToken"] !== undefined &&
      typeof parsed["refreshToken"] !== "string")
  ) {
    throw refuse("the sign-in proof has no ID token");
  }
  const idToken = parsed["idToken"];
  const refreshToken =
    typeof parsed["refreshToken"] === "string" && parsed["refreshToken"] !== ""
      ? parsed["refreshToken"]
      : undefined;

  const claims = {
    issuer: `https://securetoken.google.com/${settings.projectId}`,
    audience: settings.projectId,
    requiredClaims: ["exp", "iat", "sub", "auth_time"],
  };
  let payload: JWTPayload;
  try {
    // Emulator tokens are not signed (`alg: none`), and only emulator mode
    // accepts them.
    payload = settings.emulator
      ? UnsecuredJWT.decode(idToken, claims).payload
      : await keys.verify(idToken, fetchImpl, {
          ...claims,
          algorithms: ["RS256"],
        });
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw refuse(joseReason(error));
  }

  const subject = payload.sub;
  if (typeof subject !== "string" || subject === "" || subject.length > 128) {
    throw refuse("the token has no valid subject");
  }
  const authTime = payload["auth_time"];
  const now = seconds();
  if (typeof authTime !== "number" || authTime > now + 60) {
    throw refuse("the token has no valid auth_time");
  }
  if (now - authTime > settings.maxAuthAge) {
    throw refuse(
      `the sign-in is older than ${settings.maxAuthAge} seconds; sign in again`
    );
  }
  const details = isRecord(payload["firebase"]) ? payload["firebase"] : {};
  const provider = details["sign_in_provider"];
  if (typeof provider !== "string" || !settings.providers.includes(provider)) {
    throw refuse(
      `sign-in provider ${
        typeof provider === "string" ? printable(provider, 64) : "(none)"
      } is not allowed`
    );
  }
  const tenant =
    typeof details["tenant"] === "string" ? details["tenant"] : undefined;
  if (tenant !== settings.tenantId) {
    throw refuse(
      settings.tenantId === undefined
        ? "the user belongs to a tenant"
        : "the user belongs to another tenant"
    );
  }
  if (settings.requireVerifiedEmail && payload["email_verified"] !== true) {
    throw refuse("the email address is not verified");
  }

  const profile: Record<string, unknown> = { uid: subject };
  for (const field of ["email", "email_verified", "name", "picture"]) {
    if (payload[field] !== undefined) profile[field] = payload[field];
  }
  profile["sign_in_provider"] = provider;
  if (tenant !== undefined) profile["tenant"] = tenant;
  return {
    user: { subject, profile },
    tokens: {
      accessToken: idToken,
      idToken,
      ...(refreshToken !== undefined && { refreshToken }),
      ...(typeof payload.exp === "number" && { expiresAt: payload.exp }),
      scopes: [],
    },
  };
}

/** Names why jose refused a token, without token values. */
function joseReason(error: unknown): string {
  if (error instanceof errors.JWTClaimValidationFailed) {
    return `the ${printable(error.claim, 32)} claim is not valid for this project`;
  }
  if (error instanceof errors.JWTExpired) return "the token expired";
  if (error instanceof errors.JWKSNoMatchingKey) {
    return "the token was signed with an unknown key";
  }
  if (error instanceof errors.JOSEError) {
    return `the token is not valid (${printable(error.code, 64)})`;
  }
  return "the token is not valid";
}

/** Firebase's public keys, cached for the `max-age` of their response. */
interface SigningKeys {
  /** Verifies an ID token with the cached keys. */
  verify(
    token: string,
    fetchImpl: typeof globalThis.fetch,
    options: JWTVerifyOptions
  ): Promise<JWTPayload>;
}

interface KeyCache {
  keySet: ReturnType<typeof createLocalJWKSet>;
  fetchedAt: number;
  expiresAt: number;
}

function signingKeys(): SigningKeys {
  let cache: KeyCache | undefined;
  let pending: Promise<KeyCache> | undefined;
  const load = (fetchImpl: typeof globalThis.fetch): Promise<KeyCache> => {
    pending ??= fetchKeys(fetchImpl)
      .then((keys) => {
        cache = keys;
        return keys;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return {
    async verify(token, fetchImpl, options) {
      const current =
        cache !== undefined && cache.expiresAt > Date.now()
          ? cache
          : await load(fetchImpl);
      try {
        return (await jwtVerify(token, current.keySet, options)).payload;
      } catch (error) {
        // Google rotates keys: fetch them again for an unknown key id, but
        // not more often than the cooldown, so random ids cost nothing.
        if (
          error instanceof errors.JWKSNoMatchingKey &&
          Date.now() - current.fetchedAt > KEY_REFETCH_COOLDOWN * 1000
        ) {
          const fresh = await load(fetchImpl);
          return (await jwtVerify(token, fresh.keySet, options)).payload;
        }
        throw error;
      }
    },
  };
}

async function fetchKeys(
  fetchImpl: typeof globalThis.fetch
): Promise<KeyCache> {
  let response: Response;
  try {
    response = await fetchImpl(JWKS_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new UpstreamError(
      "temporarily_unavailable",
      "Firebase signing keys are unreachable",
      true,
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new UpstreamError(
      "server_error",
      "Firebase signing keys could not be loaded",
      response.status >= 500,
      { detail: `HTTP ${response.status}` }
    );
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!isRecord(body) || !Array.isArray(body["keys"])) {
    throw new UpstreamError(
      "server_error",
      "Firebase signing keys are not a JWK set",
      false
    );
  }
  const maxAge = /max-age=(\d+)/i.exec(
    response.headers.get("cache-control") ?? ""
  );
  // Between a minute (no refetch storm) and a day (rotations still land).
  const ttl = Math.min(
    Math.max(maxAge === null ? 3600 : Number(maxAge[1]), 60),
    86_400
  );
  const now = Date.now();
  return {
    keySet: createLocalJWKSet(body as unknown as JSONWebKeySet),
    fetchedAt: now,
    expiresAt: now + ttl * 1000,
  };
}

/** Exchanges the refresh token for a new ID token (Token Service API). */
async function refreshIdToken(
  tokens: UpstreamTokenSet,
  base: string,
  apiKey: string,
  fetchImpl: typeof globalThis.fetch
): Promise<UpstreamTokenSet> {
  const refreshToken = tokens.refreshToken;
  if (refreshToken === undefined) {
    throw new UpstreamRefreshError("MISSING_REFRESH_TOKEN", { revoked: true });
  }
  let response: Response;
  try {
    response = await fetchImpl(
      `${base}/v1/token?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      }
    );
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new UpstreamRefreshError(timeout ? "TIMEOUT" : "NETWORK_ERROR", {
      revoked: false,
      cause: error,
    });
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    // The code is the start of `error.message`, for example
    // "TOKEN_EXPIRED" or "INVALID_REFRESH_TOKEN : detail". Messages such as
    // "API key not valid" are no code, and count as temporary.
    const error = isRecord(body) ? body["error"] : undefined;
    const message =
      isRecord(error) && typeof error["message"] === "string"
        ? error["message"].trim()
        : "";
    const code =
      /^([A-Z][A-Z0-9_]*)(?:\s*:|$)/.exec(message)?.[1] ??
      `HTTP_${response.status}`;
    throw new UpstreamRefreshError(code, { revoked: REVOKED_CODES.has(code) });
  }
  if (
    !isRecord(body) ||
    typeof body["id_token"] !== "string" ||
    body["id_token"] === ""
  ) {
    throw new UpstreamRefreshError("INVALID_RESPONSE", { revoked: false });
  }
  const idToken = body["id_token"];
  // `expires_in` is a string of seconds, for example "3600".
  const expiresIn = Number(body["expires_in"]);
  const next = body["refresh_token"];
  return {
    accessToken: idToken,
    idToken,
    ...(typeof next === "string" && next !== "" && { refreshToken: next }),
    expiresAt:
      seconds() +
      (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600),
    scopes: [],
  };
}

/** JSON for a script element: nothing in it can close the element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

/**
 * The module the proxy adds to the consent page. It signs in on a click of
 * an Allow button and submits the form with the ID token and refresh token
 * as the `proof` field.
 */
function pageScript(config: string): string {
  return `
import { initializeApp } from "${SDK_URL}/firebase-app.js";
import {
  browserPopupRedirectResolver, connectAuthEmulator, FacebookAuthProvider,
  getRedirectResult, GithubAuthProvider, GoogleAuthProvider, initializeAuth,
  inMemoryPersistence, OAuthProvider, SAMLAuthProvider, signInWithPopup,
  TwitterAuthProvider,
} from "${SDK_URL}/firebase-auth.js";

const config = ${config};
// In-memory persistence: no Firebase session stays on this origin.
const auth = initializeAuth(initializeApp(config.app, "mcp-use-oauth-proxy"), {
  persistence: inMemoryPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});
if (config.emulator) connectAuthEmulator(auth, config.emulator, { disableWarnings: true });
if (config.tenantId) auth.tenantId = config.tenantId;
// Load the sign-in helpers now. Loaded on the click, they can open the
// window too late, and the browser blocks it.
getRedirectResult(auth).catch(() => {});

const messages = {
  "auth/popup-blocked": "The browser blocked the sign-in window. Allow pop-ups for this page, then try again.",
  "auth/popup-closed-by-user": "The sign-in window was closed. Try again.",
  "auth/cancelled-popup-request": "The sign-in window was closed. Try again.",
  "auth/unauthorized-domain": "This server is not an authorized domain of the Firebase project.",
  "auth/web-storage-unsupported": "This browser blocks the storage that sign-in needs. Allow third-party cookies, or use another browser.",
  "auth/operation-not-allowed": "This sign-in provider is not enabled in the Firebase project.",
};

function provider(id) {
  if (id === "google.com") return new GoogleAuthProvider();
  if (id === "github.com") return new GithubAuthProvider();
  if (id === "facebook.com") return new FacebookAuthProvider();
  if (id === "twitter.com") return new TwitterAuthProvider();
  if (id.startsWith("saml.")) return new SAMLAuthProvider(id);
  return new OAuthProvider(id);
}

function showError(form, text) {
  let box = form.querySelector("[data-mcp-use-error]");
  if (!text) {
    if (box) box.remove();
    return;
  }
  if (!box) {
    box = document.createElement("p");
    box.setAttribute("role", "alert");
    box.setAttribute("data-mcp-use-error", "");
    box.style.cssText = "color:#b42318;font-size:13px;margin:0 0 12px";
    form.prepend(box);
  }
  box.textContent = text;
}

let busy = false;
for (const button of document.querySelectorAll('[name="decision"][value="allow"]')) {
  const form = button.form;
  if (!form) continue;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (busy) return;
    const id = button.dataset.provider || config.providers[0];
    if (!config.providers.includes(id)) {
      showError(form, "This sign-in provider is not allowed on this server.");
      return;
    }
    busy = true;
    showError(form, "");
    // Called in the click handler itself, so the browser allows the window.
    signInWithPopup(auth, provider(id))
      .then(async ({ user }) => {
        let field = form.querySelector('input[name="proof"]');
        if (!field) {
          field = document.createElement("input");
          field.type = "hidden";
          field.name = "proof";
          form.append(field);
        }
        field.value = JSON.stringify({
          idToken: await user.getIdToken(),
          refreshToken: user.refreshToken,
        });
        form.requestSubmit(button);
      })
      .catch((error) => {
        busy = false;
        const code = error && error.code ? String(error.code) : "unknown";
        showError(form, messages[code] || "Sign-in failed (" + code + "). Try again.");
      });
  });
}
`;
}

function seconds(): number {
  return Math.floor(Date.now() / 1000);
}
