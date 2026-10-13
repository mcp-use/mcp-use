/**
 * The OAuth proxy's authorization server: endpoints, grants, tokens, and
 * per-request verification. One runtime exists per mounted server.
 *
 * @internal
 */
import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";

import { invalidToken } from "../errors.js";
import {
  isClientAdmitted,
  matchRedirectUri,
  registerClient,
  resolveClient,
  type ClientResolver,
} from "./clients.js";
import {
  inPageCsp,
  PAGE_CSP,
  renderCustomConsentPage,
  renderDefaultConsentPage,
  renderDefaultSignInPage,
  renderErrorPage,
  withScript,
  type ConsentPageProps,
} from "./consent.js";
import {
  pkceChallenge,
  randomToken,
  sha256,
  timingSafeEqual,
  type ProxyKeyring,
} from "./crypto.js";
import {
  keys,
  type AccessRecord,
  type ClientRecord,
  type CodeRecord,
  type GrantRecord,
  type RefreshRecord,
  type TransactionRecord,
  type UpstreamRecord,
} from "./records.js";
import type { SecureStore } from "./storage.js";
import {
  exchangeUpstreamCode,
  printable,
  refreshUpstreamTokens,
  UpstreamError,
  UpstreamRefreshError,
  type InPageProps,
  type InPageUpstream,
  type Upstream,
  type UpstreamTokenSet,
  type UpstreamUser,
} from "./upstream.js";

const TRANSACTION_TTL = 10 * 60;
const CODE_TTL = 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;
const REFRESH_GRACE = 60;
const UPSTREAM_TTL = 60 * 24 * 60 * 60;
const REMEMBER_TTL = 365 * 24 * 60 * 60;
const UPSTREAM_REFRESH_MARGIN = 60;
/**
 * How long the "grant ended" marker lives. It must outlive any refresh that
 * read the grant before it ended; lock deadlines keep those under a minute.
 */
const REVOKED_GRANT_TTL = 60 * 60;
/**
 * Lease of the refresh-token and upstream locks. Work under a lock is
 * bounded well below it: the upstream request times out after 15 seconds,
 * and nothing is written after {@link LOCK_DEADLINE}.
 */
const LOCK_TTL = 60;
/** Seconds after taking a lock within which its holder may still write. */
const LOCK_DEADLINE = 30;

/** A storage lock with a lease, owned by the request that took it. */
interface Lock {
  /**
   * Whether the lock is still this request's and its deadline has not
   * passed. Checked right before writes that the lock protects.
   */
  held(): Promise<boolean>;
  /** Releases the lock, unless another request has taken it since. */
  release(): Promise<void>;
}

/** @internal Settings fixed when the server mounts. */
export interface RuntimeConfig {
  resource: URL;
  basePath: string;
  store: SecureStore;
  keyring: () => Promise<ProxyKeyring>;
  clients: ClientResolver;
  upstream: Upstream;
  fetch: typeof globalThis.fetch;
  scopes: string[];
  accessTokenTtl: number;
  consent:
    | false
    | {
        mode: "always" | "remember";
        page?: (props: ConsentPageProps) => unknown;
      };
  /** Host of the MCP server URL, shown on the consent and sign-in pages. */
  serverHost: string;
}

/** Why a grant can no longer produce tokens. */
class GrantError extends Error {
  /**
   * @param kind - Why the grant failed.
   * @param message - Human-readable message.
   */
  constructor(
    readonly kind: "revoked" | "expired" | "transient",
    message: string
  ) {
    super(message);
  }
}

/** @internal Fields the verifier adds to `AuthInfo.extra`. */
export interface ProxyAuthExtra {
  upstreamUser: UpstreamUser;
  /** Absent when an in-page upstream issued no tokens. */
  upstream?: { accessToken: string; scopes: string[]; expiresAt?: number };
  userKey: string;
}

/** @internal The proxy authorization server for one canonical resource. */
export class ProxyRuntime {
  readonly config: RuntimeConfig;
  readonly issuer: string;
  readonly paths: {
    authorize: string;
    consent: string;
    callback: string;
    token: string;
    register: string;
    revoke: string;
  };
  readonly #secure: boolean;
  readonly #cookies: { bind: string; csrf: string; remember: string };

  /** @param config - Settings fixed when the server mounts. */
  constructor(config: RuntimeConfig) {
    this.config = config;
    this.issuer = config.resource.origin;
    const base = `${config.basePath === "/" ? "" : config.basePath}/oauth`;
    this.paths = {
      authorize: `${base}/authorize`,
      consent: `${base}/consent`,
      callback: `${base}/callback`,
      token: `${base}/token`,
      register: `${base}/register`,
      revoke: `${base}/revoke`,
    };
    this.#secure = config.resource.protocol === "https:";
    const prefix = this.#secure ? "__Host-" : "";
    this.#cookies = {
      bind: `${prefix}mcp-oauth-bind`,
      csrf: `${prefix}mcp-oauth-csrf`,
      remember: `${prefix}mcp-oauth-consent`,
    };
  }

  /** Absolute URL of a proxy path. */
  url(path: string): string {
    return new URL(path, this.issuer).href;
  }

  /** RFC 8414 metadata for this authorization server. */
  static metadata(
    resource: URL,
    basePath: string,
    options: { dcr: boolean; cimd: boolean; scopes: readonly string[] }
  ): OAuthMetadata {
    const base = `${resource.origin}${basePath === "/" ? "" : basePath}/oauth`;
    return {
      issuer: resource.origin,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      ...(options.dcr && { registration_endpoint: `${base}/register` }),
      revocation_endpoint: `${base}/revoke`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      ...(options.scopes.length > 0 && {
        scopes_supported: [...options.scopes],
      }),
      client_id_metadata_document_supported: options.cimd,
      authorization_response_iss_parameter_supported: true,
    } as OAuthMetadata;
  }

  // ─── /authorize ──────────────────────────────────────────────────────

  /** `GET /oauth/authorize`: validates the request and shows consent. */
  async authorize(c: Context): Promise<Response> {
    const query = new URL(c.req.url).searchParams;
    const clientId = query.get("client_id");
    if (clientId === null || clientId === "") {
      return this.#errorPage(
        c,
        400,
        "Missing client",
        "The request has no client_id."
      );
    }
    const client = await resolveClient(this.config.clients, clientId);
    if (typeof client === "string") {
      return this.#errorPage(c, 400, "Unknown app", client);
    }
    const requestedRedirect = query.get("redirect_uri");
    const redirectUri =
      requestedRedirect ??
      (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (
      redirectUri === undefined ||
      !matchRedirectUri(redirectUri, client.redirectUris)
    ) {
      return this.#errorPage(
        c,
        400,
        "Invalid redirect",
        "The redirect_uri is not registered for this app."
      );
    }

    // From here on, errors go back to the client's validated redirect URI.
    const state = query.get("state") ?? undefined;
    const fail = (error: string, description: string): Response =>
      this.#redirectToClient(c, redirectUri, {
        error,
        error_description: description,
        ...(state !== undefined && { state }),
      });

    if (query.get("response_type") !== "code") {
      return fail("unsupported_response_type", "response_type must be code");
    }
    const codeChallenge = query.get("code_challenge");
    if (
      codeChallenge === null ||
      query.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
    ) {
      return fail(
        "invalid_request",
        "PKCE with code_challenge_method S256 is required"
      );
    }
    const resources = query.getAll("resource");
    if (
      resources.length > 1 ||
      (resources.length === 1 && !this.#isOwnResource(resources[0]!))
    ) {
      return fail("invalid_target", "resource must be this MCP server");
    }
    const scopes = this.#grantScopes(query.get("scope"));

    const transactionId = randomToken(24);
    const transaction: TransactionRecord = {
      clientId: client.clientId,
      redirectUri,
      ...(state !== undefined && { clientState: state }),
      codeChallenge,
      resource: this.config.resource.href,
      scopes,
      upstreamVerifier: randomToken(32),
    };
    await this.config.store.set(
      keys.transaction(transactionId),
      transaction,
      TRANSACTION_TTL
    );

    if (await this.#skipConsent(c, client, redirectUri)) {
      // The provider's sign-in window opens only on a click, so an in-page
      // upstream shows a page with just the sign-in button.
      return this.config.upstream.kind === "in-page"
        ? this.#consentPage(c, transactionId, client, redirectUri, false)
        : this.#startUpstream(c, transactionId, transaction);
    }
    return this.#consentPage(c, transactionId, client, redirectUri, true);
  }

  async #skipConsent(
    c: Context,
    client: ClientRecord,
    redirectUri: string
  ): Promise<boolean> {
    const consent = this.config.consent;
    if (consent === false) return true;
    // Any local program can claim a loopback or custom-scheme redirect, so
    // only an HTTPS redirect can skip the page.
    if (!redirectUri.startsWith("https://")) return false;
    if (consent.mode !== "remember") return false;
    const remembered = await this.#readCookie(c, this.#cookies.remember);
    if (remembered === undefined) return false;
    const entry = await sha256(`${client.clientId} ${redirectUri}`);
    return remembered.split(".").includes(entry);
  }

  /**
   * Shows the consent page, bound to the transaction by a single-use CSRF
   * cookie. For an in-page upstream, `ask` is false when the consent step
   * was skipped: the page then shows only the sign-in button.
   */
  async #consentPage(
    c: Context,
    transactionId: string,
    client: ClientRecord,
    redirectUri: string,
    ask: boolean
  ): Promise<Response> {
    const csrf = randomToken(24);
    await this.#setCookie(
      c,
      this.#cookies.csrf,
      `${transactionId}.${csrf}`,
      TRANSACTION_TTL
    );
    const upstream = this.config.upstream;
    const props: ConsentPageProps = {
      client: {
        id: client.clientId,
        ...(client.clientName !== undefined && { name: client.clientName }),
        ...(client.source === "cimd" && {
          host: new URL(client.clientId).host,
        }),
        verified: client.source !== "dcr",
      },
      redirectHost: redirectHost(redirectUri),
      isNative: !redirectUri.startsWith("https:"),
      upstream: upstream.name,
      scopes: upstream.kind === "redirect" ? [...upstream.scopes] : [],
      serverHost: this.config.serverHost,
      form: {
        action: `${this.paths.consent}?txn=${encodeURIComponent(transactionId)}`,
        csrf,
      },
    };
    if (upstream.kind === "in-page") {
      return this.#signInPage(c, upstream, props, ask);
    }
    const consent = this.config.consent;
    const html =
      consent !== false && consent.page !== undefined
        ? await renderCustomConsentPage(consent.page, props)
        : renderDefaultConsentPage(props);
    return this.#html(c, 200, html);
  }

  /**
   * The consent page of an in-page upstream, with the upstream's script
   * added. Its policy allows the script by nonce and the origins the
   * upstream names. It sends no Cross-Origin-Opener-Policy: the provider's
   * sign-in window reports back through `window.opener`.
   */
  async #signInPage(
    c: Context,
    upstream: InPageUpstream,
    consentProps: ConsentPageProps,
    ask: boolean
  ): Promise<Response> {
    const nonce = randomToken(16);
    const props: InPageProps = { ...consentProps, nonce, consent: ask };
    const consent = this.config.consent;
    const html =
      consent !== false && consent.page !== undefined
        ? await renderCustomConsentPage(consent.page, props)
        : ask
          ? renderDefaultConsentPage(props)
          : renderDefaultSignInPage(props);
    return this.#html(
      c,
      200,
      withScript(html, upstream.script(nonce)),
      inPageCsp(upstream.csp, nonce)
    );
  }

  // ─── POST /consent ───────────────────────────────────────────────────

  /** `POST /oauth/consent`: records the decision and starts the upstream round. */
  async consent(c: Context): Promise<Response> {
    const transactionId = new URL(c.req.url).searchParams.get("txn") ?? "";
    const form = await formBody(c);
    const csrf = form.get("csrf") ?? "";
    const cookie = await this.#readCookie(c, this.#cookies.csrf);
    deleteCookie(c, this.#cookies.csrf, this.#cookieOptions(0));
    if (
      transactionId === "" ||
      csrf === "" ||
      cookie === undefined ||
      !timingSafeEqual(cookie, `${transactionId}.${csrf}`)
    ) {
      return this.#errorPage(
        c,
        403,
        "Sign-in expired",
        "This approval form is no longer valid."
      );
    }
    const transaction = await this.config.store.get<TransactionRecord>(
      keys.transaction(transactionId)
    );
    if (transaction === undefined) {
      return this.#errorPage(
        c,
        400,
        "Sign-in expired",
        "This sign-in took too long."
      );
    }
    if (form.get("decision") !== "allow") {
      await this.config.store.delete(keys.transaction(transactionId));
      return this.#redirectToClient(c, transaction.redirectUri, {
        error: "access_denied",
        error_description: "The user denied access",
        ...(transaction.clientState !== undefined && {
          state: transaction.clientState,
        }),
      });
    }
    const upstream = this.config.upstream;
    if (upstream.kind === "in-page") {
      return this.#inPageSignIn(
        c,
        transactionId,
        transaction,
        upstream,
        form.get("proof") ?? ""
      );
    }
    await this.#rememberIfAsked(c, transaction);
    return this.#startUpstream(c, transactionId, transaction);
  }

  /**
   * Checks the proof that an in-page upstream's script posted with the
   * Allow decision, then issues the code. The CSRF cookie was spent above,
   * so the proof is accepted once.
   */
  async #inPageSignIn(
    c: Context,
    transactionId: string,
    transaction: TransactionRecord,
    upstream: InPageUpstream,
    proof: string
  ): Promise<Response> {
    let result: { user: UpstreamUser; tokens?: UpstreamTokenSet };
    try {
      result = await upstream.verify(proof, { fetch: this.config.fetch });
      if (
        typeof result?.user?.subject !== "string" ||
        result.user.subject === ""
      ) {
        throw new Error("verify returned no subject");
      }
    } catch (error) {
      console.error(
        `[mcp-use] oauthProxy: ${upstream.name} sign-in failed:`,
        describe(error)
      );
      return this.#finish(
        c,
        transactionId,
        transaction,
        signInFailure(upstream.name, error)
      );
    }
    // Remember only a sign-in that succeeded.
    await this.#rememberIfAsked(c, transaction);
    return this.#completeSignIn(
      c,
      transactionId,
      transaction,
      result.user,
      result.tokens ?? { accessToken: "", scopes: [] }
    );
  }

  async #rememberIfAsked(
    c: Context,
    transaction: TransactionRecord
  ): Promise<void> {
    const consent = this.config.consent;
    if (
      consent !== false &&
      consent.mode === "remember" &&
      transaction.redirectUri.startsWith("https://")
    ) {
      await this.#remember(c, transaction);
    }
  }

  async #remember(c: Context, transaction: TransactionRecord): Promise<void> {
    const entry = await sha256(
      `${transaction.clientId} ${transaction.redirectUri}`
    );
    const current = (await this.#readCookie(c, this.#cookies.remember)) ?? "";
    const entries = [
      entry,
      ...current.split(".").filter((item) => item !== "" && item !== entry),
    ];
    await this.#setCookie(
      c,
      this.#cookies.remember,
      entries.slice(0, 20).join("."),
      REMEMBER_TTL
    );
  }

  /** Binds the browser with a cookie and sends it to the upstream provider. */
  async #startUpstream(
    c: Context,
    transactionId: string,
    transaction: TransactionRecord,
    extraParams: Readonly<Record<string, string>> = {}
  ): Promise<Response> {
    const upstream = this.config.upstream;
    if (upstream.kind !== "redirect") {
      throw new Error("An in-page upstream has no upstream redirect");
    }
    const state = randomToken(32);
    await this.config.store.set(
      keys.upstreamState(await sha256(state)),
      transactionId,
      TRANSACTION_TTL
    );
    await this.#setCookie(c, this.#cookies.bind, state, TRANSACTION_TTL);

    const target = new URL(upstream.authorizationEndpoint);
    const params = target.searchParams;
    params.set("response_type", "code");
    params.set("client_id", upstream.clientId);
    params.set("redirect_uri", this.url(this.paths.callback));
    params.set("state", state);
    if (upstream.scopes.length > 0)
      params.set("scope", upstream.scopes.join(" "));
    if (upstream.pkce !== false) {
      params.set(
        "code_challenge",
        await pkceChallenge(transaction.upstreamVerifier)
      );
      params.set("code_challenge_method", "S256");
    }
    for (const [name, value] of Object.entries({
      ...upstream.authorizeParams,
      ...extraParams,
    })) {
      params.set(name, value);
    }
    return this.#redirect(c, target.href);
  }

  // ─── GET /callback ───────────────────────────────────────────────────

  /** `GET /oauth/callback`: finishes the upstream round and issues a code. */
  async callback(c: Context): Promise<Response> {
    const upstream = this.config.upstream;
    if (upstream.kind !== "redirect") {
      return this.#errorPage(
        c,
        400,
        "Sign-in failed",
        "This server does not use a sign-in callback."
      );
    }
    const params = new URL(c.req.url).searchParams;
    const state = params.get("state");
    if (state === null || state === "") {
      return this.#errorPage(
        c,
        400,
        "Sign-in failed",
        "The sign-in response has no state."
      );
    }
    // Spend the state first, so a replayed callback can never continue.
    const transactionId = await this.config.store.take<string>(
      keys.upstreamState(await sha256(state))
    );
    if (typeof transactionId !== "string") {
      return this.#errorPage(
        c,
        400,
        "Sign-in expired",
        "This sign-in expired or was already used."
      );
    }
    const bound = await this.#readCookie(c, this.#cookies.bind);
    deleteCookie(c, this.#cookies.bind, this.#cookieOptions(0));
    if (bound === undefined || !timingSafeEqual(bound, state)) {
      return this.#errorPage(
        c,
        403,
        "Sign-in not recognized",
        "This sign-in was not started in this browser."
      );
    }
    const transaction = await this.config.store.get<TransactionRecord>(
      keys.transaction(transactionId)
    );
    if (transaction === undefined) {
      return this.#errorPage(
        c,
        400,
        "Sign-in expired",
        "This sign-in took too long."
      );
    }
    const finish = (values: Record<string, string>): Promise<Response> =>
      this.#finish(c, transactionId, transaction, values);

    const upstreamError = params.get("error");
    if (upstreamError !== null) {
      // The browser delivers these parameters, so they are cleaned first.
      const code = printable(upstreamError, 64);
      const description = params.get("error_description");
      const reason = `${upstream.name} returned ${code}${
        description === null ? "" : `: ${printable(description)}`
      }`;
      if (code === "access_denied") {
        console.info(`[mcp-use] oauthProxy: sign-in declined. ${reason}`);
      } else {
        console.error(`[mcp-use] oauthProxy: sign-in failed. ${reason}`);
      }
      return finish({
        error: code === "access_denied" ? "access_denied" : "server_error",
        error_description: errorDescription(
          `${upstream.name} sign-in did not complete (${code})`
        ),
      });
    }

    let tokens: UpstreamTokenSet;
    let user: UpstreamUser;
    try {
      tokens = await exchangeUpstreamCode(upstream, this.config.fetch, {
        callbackParams: params,
        redirectUri: this.url(this.paths.callback),
        codeVerifier:
          upstream.pkce === false ? undefined : transaction.upstreamVerifier,
      });
      user = await upstream.fetchUser(tokens, this.config.fetch);
      if (typeof user?.subject !== "string" || user.subject === "") {
        throw new Error("fetchUser returned no subject");
      }
    } catch (error) {
      console.error(
        `[mcp-use] oauthProxy: ${upstream.name} sign-in failed:`,
        describe(error)
      );
      return finish(signInFailure(upstream.name, error));
    }

    const userKey = `${upstream.id}:${user.subject}`;
    if (
      tokens.refreshToken === undefined &&
      upstream.retryWithoutRefreshToken !== undefined &&
      transaction.retried !== true
    ) {
      const existing = await this.config.store.get<UpstreamRecord>(
        keys.upstream(userKey)
      );
      if (existing?.tokens.refreshToken === undefined) {
        const retry: TransactionRecord = {
          ...transaction,
          retried: true,
          upstreamVerifier: randomToken(32),
        };
        await this.config.store.set(
          keys.transaction(transactionId),
          retry,
          TRANSACTION_TTL
        );
        return this.#startUpstream(
          c,
          transactionId,
          retry,
          upstream.retryWithoutRefreshToken
        );
      }
    }

    return this.#completeSignIn(c, transactionId, transaction, user, tokens);
  }

  /**
   * Finishes a sign-in that the upstream confirmed: stores the user's
   * upstream tokens, issues a one-time code, and sends the browser back to
   * the client.
   */
  async #completeSignIn(
    c: Context,
    transactionId: string,
    transaction: TransactionRecord,
    user: UpstreamUser,
    tokens: UpstreamTokenSet
  ): Promise<Response> {
    const userKey = `${this.config.upstream.id}:${user.subject}`;
    const record = await this.#saveUpstream(userKey, tokens, user);
    const code = randomToken(32);
    const codeRecord: CodeRecord = {
      clientId: transaction.clientId,
      redirectUri: transaction.redirectUri,
      codeChallenge: transaction.codeChallenge,
      resource: transaction.resource,
      scopes: transaction.scopes,
      userKey,
      generation: record.generation,
    };
    await this.config.store.set(
      keys.code(await sha256(code)),
      codeRecord,
      CODE_TTL
    );
    return this.#finish(c, transactionId, transaction, { code });
  }

  /** Ends the transaction and sends the browser back to the client. */
  async #finish(
    c: Context,
    transactionId: string,
    transaction: TransactionRecord,
    values: Record<string, string>
  ): Promise<Response> {
    await this.config.store.delete(keys.transaction(transactionId));
    return this.#redirectToClient(c, transaction.redirectUri, {
      ...values,
      ...(transaction.clientState !== undefined && {
        state: transaction.clientState,
      }),
    });
  }

  async #saveUpstream(
    userKey: string,
    tokens: UpstreamTokenSet,
    user: UpstreamUser
  ): Promise<UpstreamRecord> {
    const existing = await this.config.store.get<UpstreamRecord>(
      keys.upstream(userKey)
    );
    const refreshToken = tokens.refreshToken ?? existing?.tokens.refreshToken;
    const record: UpstreamRecord = {
      userKey,
      generation: existing?.generation ?? randomToken(16),
      version: (existing?.version ?? 0) + 1,
      tokens: {
        ...tokens,
        ...(refreshToken !== undefined && { refreshToken }),
      },
      user,
    };
    await this.config.store.set(keys.upstream(userKey), record, UPSTREAM_TTL);
    return record;
  }

  // ─── POST /token ─────────────────────────────────────────────────────

  /** `POST /oauth/token`: the authorization-code and refresh-token grants. */
  async token(c: Context): Promise<Response> {
    const form = await formBody(c);
    try {
      switch (form.get("grant_type")) {
        case "authorization_code":
          return await this.#authorizationCodeGrant(c, form);
        case "refresh_token":
          return await this.#refreshTokenGrant(c, form);
        default:
          return this.#tokenError(
            c,
            "unsupported_grant_type",
            "grant_type must be authorization_code or refresh_token"
          );
      }
    } catch (error) {
      if (error instanceof GrantError) {
        return error.kind === "transient"
          ? this.#tokenError(c, "temporarily_unavailable", error.message, 503)
          : this.#tokenError(c, "invalid_grant", error.message);
      }
      throw error;
    }
  }

  async #authorizationCodeGrant(
    c: Context,
    form: URLSearchParams
  ): Promise<Response> {
    const code = form.get("code") ?? "";
    const codeHash = await sha256(code);
    // Spend the code before any check, so a wrong verifier also burns it.
    const record =
      code === ""
        ? undefined
        : await this.config.store.take<CodeRecord>(keys.code(codeHash));
    if (record === undefined) {
      const grantId = await this.config.store.get<string>(
        keys.codeUsed(codeHash)
      );
      if (typeof grantId === "string") {
        // A replayed code means it leaked: revoke what it produced.
        await this.#endGrant(grantId);
      }
      return this.#tokenError(
        c,
        "invalid_grant",
        "The authorization code is invalid, expired, or used"
      );
    }
    if (form.get("client_id") !== record.clientId) {
      return this.#tokenError(
        c,
        "invalid_grant",
        "The code was issued to another client"
      );
    }
    // The code is already spent, and no grant exists yet.
    if (!isClientAdmitted(this.config.clients, record.clientId)) {
      return this.#clientNotAllowed(c);
    }
    if (
      form.get("redirect_uri") !== null &&
      form.get("redirect_uri") !== record.redirectUri
    ) {
      return this.#tokenError(
        c,
        "invalid_grant",
        "redirect_uri does not match the authorization request"
      );
    }
    const resources = form.getAll("resource");
    if (
      resources.length > 1 ||
      (resources.length === 1 && !this.#isOwnResource(resources[0]!))
    ) {
      return this.#tokenError(
        c,
        "invalid_target",
        "resource must be this MCP server"
      );
    }
    const verifier = form.get("code_verifier") ?? "";
    if (
      !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
      !timingSafeEqual(await pkceChallenge(verifier), record.codeChallenge)
    ) {
      return this.#tokenError(
        c,
        "invalid_grant",
        "code_verifier does not match the code challenge"
      );
    }

    const upstream = await this.#liveUpstream(
      record.userKey,
      record.generation
    );
    await this.#freshUpstream(upstream);
    const grant: GrantRecord = {
      id: randomToken(16),
      clientId: record.clientId,
      userKey: record.userKey,
      generation: record.generation,
      scopes: record.scopes,
      resource: record.resource,
    };
    await this.config.store.set(keys.grant(grant.id), grant, REFRESH_TTL);
    await this.config.store.add(keys.codeUsed(codeHash), grant.id, CODE_TTL);
    return this.#tokenResponse(c, grant, grant.scopes);
  }

  async #refreshTokenGrant(
    c: Context,
    form: URLSearchParams
  ): Promise<Response> {
    const token = form.get("refresh_token") ?? "";
    if (!token.startsWith("mcp_rt_")) {
      return this.#tokenError(
        c,
        "invalid_grant",
        "The refresh token is invalid"
      );
    }
    const hash = await sha256(token);
    const lock = await this.#lock(keys.refreshLock(hash));
    try {
      const record = await this.config.store.get<RefreshRecord>(
        keys.refresh(hash)
      );
      if (record === undefined) {
        return this.#tokenError(
          c,
          "invalid_grant",
          "The refresh token is invalid or expired"
        );
      }
      const grant = await this.config.store.get<GrantRecord>(
        keys.grant(record.grantId)
      );
      if (grant === undefined) {
        return this.#tokenError(c, "invalid_grant", "The grant was revoked");
      }
      if (form.get("client_id") !== record.clientId) {
        return this.#tokenError(
          c,
          "invalid_grant",
          "The refresh token was issued to another client"
        );
      }
      if (!isClientAdmitted(this.config.clients, record.clientId)) {
        await this.#endGrant(grant.id);
        await this.config.store.delete(keys.refresh(hash));
        return this.#clientNotAllowed(c);
      }
      const asked = (form.get("scope") ?? "").split(" ").filter(Boolean);
      if (!asked.every((scope) => grant.scopes.includes(scope))) {
        return this.#tokenError(
          c,
          "invalid_scope",
          "scope exceeds the original grant"
        );
      }
      // A narrower scope applies to the new access token only. The grant,
      // and so the new refresh token, keeps every scope (RFC 6749 §6).
      const scopes =
        asked.length === 0
          ? grant.scopes
          : grant.scopes.filter((scope) => asked.includes(scope));
      const resources = form.getAll("resource");
      if (
        resources.length > 1 ||
        (resources.length === 1 && !this.#isOwnResource(resources[0]!))
      ) {
        return this.#tokenError(
          c,
          "invalid_target",
          "resource must be this MCP server"
        );
      }

      const now = seconds();
      if (record.state === "rotated") {
        const inGrace =
          record.graceUsed !== true &&
          record.rotatedAt !== undefined &&
          now - record.rotatedAt <= REFRESH_GRACE;
        if (!inGrace) {
          // A rotated token came back: someone else holds it. End the grant.
          await this.#endGrant(grant.id);
          await this.config.store.delete(keys.refresh(hash));
          return this.#tokenError(
            c,
            "invalid_grant",
            "The refresh token was already used"
          );
        }
      }

      const upstream = await this.#liveUpstream(
        grant.userKey,
        grant.generation
      );
      const fresh = await this.#freshUpstream(upstream);
      if (
        fresh.tokens.expiresAt !== undefined &&
        fresh.tokens.expiresAt <= now &&
        fresh.tokens.refreshToken === undefined
      ) {
        throw new GrantError(
          "expired",
          `The ${this.config.upstream.name} sign-in expired`
        );
      }

      // A request that outlived its lock may race one that took the lock
      // after it; only the holder may rotate the token.
      if (!(await lock.held())) {
        throw new GrantError(
          "transient",
          "The token refresh took too long; try again"
        );
      }
      const rotated: RefreshRecord =
        record.state === "active"
          ? { ...record, state: "rotated", rotatedAt: now }
          : { ...record, graceUsed: true };
      await this.config.store.set(keys.refresh(hash), rotated, REFRESH_TTL);
      // Rewriting the grant extends its lifetime while the client stays
      // active. If the grant ended since it was read above, the rewrite has
      // just restored it: the marker that #endGrant writes before deleting
      // tells, so delete it again. A grant ended after this check is
      // deleted after the rewrite, and the tokens below die with it.
      await this.config.store.set(keys.grant(grant.id), grant, REFRESH_TTL);
      if (
        (await this.config.store.get(keys.revokedGrant(grant.id))) !== undefined
      ) {
        await this.config.store.delete(keys.grant(grant.id));
        return this.#tokenError(c, "invalid_grant", "The grant was revoked");
      }
      await this.#touchUpstream(fresh);
      return this.#tokenResponse(c, grant, scopes);
    } finally {
      await lock.release();
    }
  }

  /**
   * Issues a new access and refresh token for a grant.
   *
   * @param scopes - Scopes of the access token: the grant's, or fewer.
   */
  async #tokenResponse(
    c: Context,
    grant: GrantRecord,
    scopes: string[]
  ): Promise<Response> {
    const ttl = this.config.accessTokenTtl;
    const accessToken = `mcp_at_${randomToken(32)}`;
    const refreshToken = `mcp_rt_${randomToken(32)}`;
    const access: AccessRecord = {
      grantId: grant.id,
      expiresAt: seconds() + ttl,
      scopes,
    };
    const refresh: RefreshRecord = {
      grantId: grant.id,
      clientId: grant.clientId,
      state: "active",
    };
    await this.config.store.set(
      keys.access(await sha256(accessToken)),
      access,
      ttl
    );
    await this.config.store.set(
      keys.refresh(await sha256(refreshToken)),
      refresh,
      REFRESH_TTL
    );
    return this.#json(c, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ttl,
      refresh_token: refreshToken,
      ...(scopes.length > 0 && { scope: scopes.join(" ") }),
    });
  }

  // ─── POST /register and POST /revoke ─────────────────────────────────

  /** `POST /oauth/register`: dynamic client registration. */
  async register(c: Context): Promise<Response> {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return this.#json(c, 400, {
        error: "invalid_client_metadata",
        error_description: "The body must be JSON client metadata",
      });
    }
    const result = await registerClient(this.config.store, body);
    if (!result.ok) {
      return this.#json(c, 400, {
        error: result.error,
        error_description: result.description,
      });
    }
    return this.#json(c, 201, result.response);
  }

  /** `POST /oauth/revoke`: RFC 7009 token revocation. */
  async revoke(c: Context): Promise<Response> {
    const form = await formBody(c);
    const token = form.get("token") ?? "";
    const clientId = form.get("client_id");
    let grantId: string | undefined;
    if (token.startsWith("mcp_at_")) {
      grantId = (
        await this.config.store.get<AccessRecord>(
          keys.access(await sha256(token))
        )
      )?.grantId;
    } else if (token.startsWith("mcp_rt_")) {
      grantId = (
        await this.config.store.get<RefreshRecord>(
          keys.refresh(await sha256(token))
        )
      )?.grantId;
    }
    if (grantId !== undefined) {
      const grant = await this.config.store.get<GrantRecord>(
        keys.grant(grantId)
      );
      if (grant !== undefined && grant.clientId === clientId) {
        await this.#endGrant(grantId);
      }
    }
    // RFC 7009: unknown and foreign tokens get the same answer.
    return this.#json(c, 200, {});
  }

  /** CORS preflight for endpoints that browser-based clients call. */
  preflight(c: Context): Response {
    c.header("access-control-allow-origin", "*");
    c.header("access-control-allow-methods", "POST, OPTIONS");
    c.header(
      "access-control-allow-headers",
      "content-type, authorization, mcp-protocol-version"
    );
    c.header("access-control-max-age", "86400");
    return c.body(null, 204);
  }

  // ─── Per-request verification ────────────────────────────────────────

  /** Verifies a proxy access token on each MCP request. */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!token.startsWith("mcp_at_")) {
      throw invalidToken("The access token was not issued by this server");
    }
    const access = await this.config.store.get<AccessRecord>(
      keys.access(await sha256(token))
    );
    if (access === undefined || access.expiresAt <= seconds()) {
      throw invalidToken("The access token is invalid or expired");
    }
    const grant = await this.config.store.get<GrantRecord>(
      keys.grant(access.grantId)
    );
    if (grant === undefined) {
      throw invalidToken("The grant was revoked");
    }
    if (!isClientAdmitted(this.config.clients, grant.clientId)) {
      // End the sign-in for good, so that allowing the client again does not
      // bring back tokens issued before it was removed.
      await this.#endGrant(grant.id);
      throw invalidToken("The app is no longer allowed on this server");
    }
    let upstream: UpstreamRecord;
    try {
      upstream = await this.#freshUpstream(
        await this.#liveUpstream(grant.userKey, grant.generation)
      );
    } catch (error) {
      if (error instanceof GrantError && error.kind !== "transient") {
        throw invalidToken(error.message);
      }
      throw error;
    }
    if (
      upstream.tokens.expiresAt !== undefined &&
      upstream.tokens.expiresAt <= seconds()
    ) {
      throw invalidToken(`The ${this.config.upstream.name} sign-in expired`);
    }
    const extra: ProxyAuthExtra = {
      upstreamUser: upstream.user,
      // An in-page upstream whose `verify` returned no tokens stores an
      // empty access token; tools then get none.
      ...(upstream.tokens.accessToken !== "" && {
        upstream: {
          accessToken: upstream.tokens.accessToken,
          scopes: [...upstream.tokens.scopes],
          ...(upstream.tokens.expiresAt !== undefined && {
            expiresAt: upstream.tokens.expiresAt,
          }),
        },
      }),
      userKey: grant.userKey,
    };
    return {
      token,
      clientId: grant.clientId,
      scopes: [...(access.scopes ?? grant.scopes)],
      expiresAt: access.expiresAt,
      resource: new URL(grant.resource),
      extra: extra as unknown as Record<string, unknown>,
    };
  }

  async #liveUpstream(
    userKey: string,
    generation: string
  ): Promise<UpstreamRecord> {
    const record = await this.config.store.get<UpstreamRecord>(
      keys.upstream(userKey)
    );
    if (record === undefined || record.generation !== generation) {
      throw new GrantError(
        "revoked",
        `The ${this.config.upstream.name} sign-in was revoked`
      );
    }
    return record;
  }

  /**
   * Returns the upstream record with an access token that is not about to
   * expire, refreshing it at most once across all instances (storage lock).
   */
  async #freshUpstream(record: UpstreamRecord): Promise<UpstreamRecord> {
    const now = seconds();
    const expiresAt = record.tokens.expiresAt;
    if (expiresAt === undefined || expiresAt - UPSTREAM_REFRESH_MARGIN > now) {
      return record;
    }
    const refreshToken = record.tokens.refreshToken;
    if (refreshToken === undefined) return record;
    const provider = this.config.upstream;
    if (provider.kind === "in-page" && provider.refresh === undefined) {
      return record;
    }

    const lock = await this.#tryLock(keys.upstreamLock(record.userKey));
    if (lock === undefined) {
      // Another request refreshes now; wait for its result.
      for (let attempt = 0; attempt < 25; attempt++) {
        await sleep(200);
        const current = await this.#liveUpstream(
          record.userKey,
          record.generation
        );
        if (current.version !== record.version) return current;
      }
      if (expiresAt > seconds()) return record;
      throw new GrantError(
        "transient",
        `${this.config.upstream.name} refresh is taking too long`
      );
    }
    try {
      const current = await this.#liveUpstream(
        record.userKey,
        record.generation
      );
      if (current.version !== record.version) return current;
      let tokens: UpstreamTokenSet;
      try {
        tokens =
          provider.kind === "in-page"
            ? await provider.refresh!(current.tokens, {
                fetch: this.config.fetch,
              })
            : await refreshUpstreamTokens(
                provider,
                this.config.fetch,
                refreshToken
              );
      } catch (error) {
        if (
          (error instanceof UpstreamError &&
            !error.transient &&
            error.code === "invalid_grant") ||
          (error instanceof UpstreamRefreshError && error.revoked)
        ) {
          console.warn(
            `[mcp-use] oauthProxy: ${describe(error)}. The user's sign-ins end; they must sign in again.`
          );
          const latest = await this.config.store.get<UpstreamRecord>(
            keys.upstream(record.userKey)
          );
          if (
            latest?.generation === current.generation &&
            latest.version === current.version
          ) {
            // The user revoked the app upstream: end every grant of theirs.
            await this.config.store.delete(keys.upstream(record.userKey));
          }
          throw new GrantError(
            "revoked",
            `The ${this.config.upstream.name} sign-in was revoked`
          );
        }
        console.error(
          `[mcp-use] oauthProxy: ${this.config.upstream.name} refresh failed:`,
          describe(error)
        );
        if (expiresAt > seconds()) return current;
        throw new GrantError(
          "transient",
          `${this.config.upstream.name} is unavailable`
        );
      }
      // Read again before writing: writing the refreshed tokens over a
      // sign-in that ended during the request would bring it back.
      const latest = await this.config.store.get<UpstreamRecord>(
        keys.upstream(record.userKey)
      );
      if (latest === undefined || latest.generation !== current.generation) {
        throw new GrantError(
          "revoked",
          `The ${this.config.upstream.name} sign-in was revoked`
        );
      }
      if (latest.version !== current.version) return latest;
      if (!(await lock.held())) {
        throw new GrantError(
          "transient",
          `${this.config.upstream.name} refresh took too long`
        );
      }
      const next: UpstreamRecord = {
        ...current,
        version: current.version + 1,
        tokens: {
          ...tokens,
          refreshToken: tokens.refreshToken ?? refreshToken,
        },
      };
      await this.config.store.set(
        keys.upstream(record.userKey),
        next,
        UPSTREAM_TTL
      );
      return next;
    } finally {
      await lock.release();
    }
  }

  /**
   * Extends the upstream record's lifetime while the user stays active.
   * Skipped when another request holds the upstream lock, so a refresh in
   * progress is never overwritten with an older version.
   */
  async #touchUpstream(record: UpstreamRecord): Promise<void> {
    const lock = await this.#tryLock(keys.upstreamLock(record.userKey));
    if (lock === undefined) return;
    try {
      const current = await this.config.store.get<UpstreamRecord>(
        keys.upstream(record.userKey)
      );
      if (
        current !== undefined &&
        current.generation === record.generation &&
        current.version === record.version
      ) {
        await this.config.store.set(
          keys.upstream(record.userKey),
          current,
          UPSTREAM_TTL
        );
      }
    } finally {
      await lock.release();
    }
  }

  /**
   * Ends a grant. The marker written first outlives any refresh of the grant
   * in progress, which checks it after rewriting the grant (see
   * #refreshTokenGrant), so the refresh cannot bring the grant back.
   */
  async #endGrant(grantId: string): Promise<void> {
    await this.config.store.set(
      keys.revokedGrant(grantId),
      true,
      REVOKED_GRANT_TTL
    );
    await this.config.store.delete(keys.grant(grantId));
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  /**
   * Takes a lock, waiting up to 5 seconds for its holder. The lock stores a
   * random owner value, so a holder whose lease ran out never releases or
   * writes under a lock that another request took since.
   */
  async #lock(key: string): Promise<Lock> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const lock = await this.#tryLock(key);
      if (lock !== undefined) return lock;
      await sleep(100);
    }
    throw new GrantError("transient", "The token is in use by another request");
  }

  /**
   * Takes a lock if it is free. Storage has no compare-and-delete, so
   * `held()` and `release()` read the owner before acting; the lease is long
   * enough that the holder finishes well before it can expire in between.
   */
  async #tryLock(key: string): Promise<Lock | undefined> {
    const store = this.config.store;
    const owner = randomToken(16);
    if (!(await store.add(key, owner, LOCK_TTL))) return undefined;
    const deadline = Date.now() + LOCK_DEADLINE * 1000;
    const owned = async () => (await store.get<string>(key)) === owner;
    return {
      held: async () => Date.now() < deadline && (await owned()),
      release: async () => {
        if (await owned()) await store.delete(key);
      },
    };
  }

  #isOwnResource(value: string): boolean {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    const strip = (pathname: string): string =>
      pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
    return (
      url.origin === this.config.resource.origin &&
      strip(url.pathname) === strip(this.config.resource.pathname)
    );
  }

  /**
   * Scopes for a new grant. Unknown scopes are dropped rather than rejected
   * (RFC 6749 section 3.3): clients often send upstream scopes such as
   * `read:user`. With no known scope left, the grant gets the default set.
   * The token response echoes the granted scopes.
   */
  #grantScopes(requested: string | null): string[] {
    const supported = this.config.scopes;
    const asked = (requested ?? "")
      .split(" ")
      .filter((scope) => supported.includes(scope));
    return asked.length === 0 ? [...supported] : [...new Set(asked)];
  }

  #cookieOptions(maxAge: number) {
    return {
      path: "/",
      httpOnly: true,
      secure: this.#secure,
      sameSite: "Lax" as const,
      maxAge,
    };
  }

  async #setCookie(
    c: Context,
    name: string,
    value: string,
    maxAge: number
  ): Promise<void> {
    const keyring = await this.config.keyring();
    await setSignedCookie(
      c,
      name,
      value,
      keyring.current.cookie,
      this.#cookieOptions(maxAge)
    );
  }

  async #readCookie(c: Context, name: string): Promise<string | undefined> {
    const keyring = await this.config.keyring();
    for (const key of keyring.all) {
      const value = await getSignedCookie(c, key.cookie, name);
      if (typeof value === "string") return value;
    }
    return undefined;
  }

  #headers(c: Context): void {
    c.header("cache-control", "no-store");
    c.header("pragma", "no-cache");
    c.header("referrer-policy", "no-referrer");
    c.header("x-content-type-options", "nosniff");
  }

  #html(
    c: Context,
    status: 200 | 400 | 403,
    html: string,
    csp: string = PAGE_CSP
  ): Response {
    this.#headers(c);
    c.header("content-security-policy", csp);
    c.header("x-frame-options", "DENY");
    return c.html(html, status);
  }

  #errorPage(
    c: Context,
    status: 400 | 403,
    title: string,
    message: string
  ): Response {
    return this.#html(c, status, renderErrorPage(title, message));
  }

  #json(
    c: Context,
    status: 200 | 201 | 400 | 401 | 503,
    body: unknown
  ): Response {
    this.#headers(c);
    c.header("access-control-allow-origin", "*");
    return c.json(body, status);
  }

  #tokenError(
    c: Context,
    error: string,
    description: string,
    status: 400 | 503 = 400
  ): Response {
    return this.#json(c, status, { error, error_description: description });
  }

  /** A client that the settings do not admit. */
  #clientNotAllowed(c: Context): Response {
    return this.#tokenError(
      c,
      "invalid_client",
      "This app is not allowed to connect to this server"
    );
  }

  #redirect(c: Context, location: string): Response {
    this.#headers(c);
    return c.redirect(location, 302);
  }

  #redirectToClient(
    c: Context,
    redirectUri: string,
    values: Record<string, string>
  ): Response {
    const target = new URL(redirectUri);
    for (const [name, value] of Object.entries(values)) {
      target.searchParams.set(name, value);
    }
    target.searchParams.set("iss", this.issuer);
    return this.#redirect(c, target.href);
  }
}

async function formBody(c: Context): Promise<URLSearchParams> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const body: unknown = await c.req.json();
      const params = new URLSearchParams();
      if (body !== null && typeof body === "object") {
        for (const [name, value] of Object.entries(body)) {
          if (typeof value === "string") params.append(name, value);
        }
      }
      return params;
    } catch {
      return new URLSearchParams();
    }
  }
  try {
    return new URLSearchParams(await c.req.text());
  } catch {
    return new URLSearchParams();
  }
}

function redirectHost(uri: string): string {
  const url = new URL(uri);
  return url.host !== "" ? url.host : `${url.protocol}//`;
}

function seconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @internal Describes an error for logs. An upstream error gives only its
 * safe summary, since its causes can hold tokens; any other error gives its
 * stack.
 */
export function describe(error: unknown): string {
  if (error instanceof UpstreamError) {
    return `${error.message}${error.detail === undefined ? "" : ` (${error.detail})`}`;
  }
  if (error instanceof UpstreamRefreshError) {
    return error.message;
  }
  if (!(error instanceof Error)) return String(error);
  let text = error.stack ?? `${error.name}: ${error.message}`;
  let cause: unknown = error.cause;
  for (let depth = 0; cause instanceof Error && depth < 3; depth++) {
    const code =
      "code" in cause && typeof cause.code === "string"
        ? ` [${cause.code}]`
        : "";
    text += `\n  caused by ${cause.name}: ${cause.message}${code}`;
    cause = cause.cause;
  }
  return text;
}

/** The redirect parameters that tell the client why the sign-in failed. */
function signInFailure(
  upstreamName: string,
  error: unknown
): Record<string, string> {
  if (!(error instanceof UpstreamError)) {
    return {
      error: "server_error",
      error_description: `${upstreamName} sign-in failed`,
    };
  }
  const reason =
    error.upstreamCode === undefined ? "" : ` (${error.upstreamCode})`;
  return {
    error:
      error.code === "access_denied"
        ? "access_denied"
        : error.transient
          ? "temporarily_unavailable"
          : "server_error",
    error_description: errorDescription(
      `${upstreamName} sign-in failed${reason}${
        error.description === undefined ? "" : `: ${error.description}`
      }`
    ),
  };
}

/** Limits text to the characters that RFC 6749 allows in error_description. */
function errorDescription(text: string): string {
  const safe = text
    .replace(/"/g, "'")
    .replace(/[^\x20-\x21\x23-\x5b\x5d-\x7e]/g, "");
  return safe.length > 300 ? `${safe.slice(0, 299)}.` : safe;
}
