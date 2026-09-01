import type { OAuthTokenVerifier } from "@modelcontextprotocol/server";

import type { OAuthResourceOptions } from "../provider.js";

/** Reserved tool that completes Lane's step-up for the calling credential. */
export const LANE_STEP_UP_TOOL = "lane_register_session";

/** Reserved diagnostic tool reporting what Lane knows about the caller. */
export const LANE_SESSION_INFO_TOOL = "lane_session_info";

/** Registered name of the public auth-guide resource. */
export const LANE_AUTH_GUIDE_NAME = "lane-auth-guide";

/** URI of the public auth-guide resource. */
export const LANE_AUTH_GUIDE_URI = "lane://auth-guide";

/** Lane's production authorization server issuer. */
export const LANE_DEFAULT_ISSUER = "https://auth.getonlane.com/auth/mcp";

/** Scope that permits recording the agent's model-authored task summary. */
export const LANE_PERSONALIZATION_SCOPE = "personalization:connection";

/** Maximum stored length of the step-up `task` summary. */
export const LANE_TASK_MAX_CHARS = 600;

/** Normalized identity mapped from a verified Lane access token. */
export interface LaneOAuthUser {
  /** Pairwise subject: stable at this server, different at every other one. */
  id: string;
  /** OAuth `client_id` of the calling agent application. */
  agentId: string;
  /** Token `jti`; identifies the credential a connection is recorded for. */
  credentialId: string;
  /** Claimed merchant host the token was minted for, when present. */
  host?: string;
  /** Lane account tier, when present. */
  tier?: string;
  /** Whether Lane verified the calling client, when present. */
  clientVerified?: boolean;
  /** When the human last authenticated, in Unix seconds, when present. */
  authTime?: number;
}

/** Identifies one connection: a subject on one credential. */
export interface LaneConnectionKey {
  /** Pairwise subject from the verified token. */
  sub: string;
  /** Token `jti`. A refreshed token is a new credential. */
  jti: string;
}

/** Data recorded when a step-up completes. */
export interface LaneConnectionInput {
  /** Scopes granted by the token exchange. This is the caller's authority. */
  scopes: string[];
  /** Exchanged access token. Stores may discard it; nothing reads it back. */
  accessToken?: string;
  /** Expiry of the exchanged token, in Unix seconds. */
  expiresAt?: number;
  /** Sanitized task summary, recorded only when consent permits it. */
  task?: string;
}

/** A stored connection. */
export interface LaneConnectionRecord extends LaneConnectionInput {
  /** When the connection was recorded, in Unix milliseconds. */
  createdAt: number;
}

/**
 * Persistence for Lane connections. Provide a shared store (KV, database)
 * when more than one server instance answers for the same resource;
 * {@link memoryLaneConnectionStore} is only correct for a single process.
 */
export interface LaneConnectionStore {
  /** Returns the stored connection, or `null` when none is recorded. */
  get(key: LaneConnectionKey): Promise<LaneConnectionRecord | null>;
  /** Records a connection, replacing any previous record for the key. */
  put(
    key: LaneConnectionKey,
    value: LaneConnectionInput
  ): Promise<LaneConnectionRecord>;
  /** Removes a connection. Optional; used for operator-driven revocation. */
  delete?(key: LaneConnectionKey): Promise<void>;
}

/** Input to an RFC 8693 token exchange. */
export interface LaneTokenExchangeRequest {
  /** The caller's verified bearer token. */
  subjectToken: string;
  /** This server's canonical resource, sent as the RFC 8707 `resource`. */
  resource: string;
}

/** Result of a successful token exchange. */
export interface LaneTokenExchangeResult {
  /** Access token minted for this server. Never returned to callers. */
  accessToken: string;
  /** Scopes granted by Lane at exchange time. */
  scopes: string[];
  /** Lifetime in seconds, when Lane reports one. */
  expiresIn?: number;
}

/** Performs the server-side token exchange behind the step-up tool. */
export interface LaneTokenExchanger {
  /**
   * Exchanges the caller's bearer for a token scoped to this server.
   *
   * @throws When Lane refuses the exchange or cannot be reached.
   */
  exchange(request: LaneTokenExchangeRequest): Promise<LaneTokenExchangeResult>;
}

/**
 * What the gate does when a verified caller has no recorded connection.
 *
 * - `"gate-all"`: refuse every application tool with an error result until the
 *   caller completes the step-up. Lane's production behavior.
 * - `"log-only"`: never refuse; emit `would-have-blocked` gate events instead.
 *   For rolling the gate out against live traffic before enforcing it.
 */
export type LaneEnforcement = "gate-all" | "log-only";

/** Outcome of one gate decision. */
export type LaneGateDecision = "allowed" | "blocked" | "would-have-blocked";

/** Emitted once per application tool call after the gate decides. */
export interface LaneGateEvent {
  /** What the gate did. */
  decision: LaneGateDecision;
  /** Tool the caller invoked. */
  tool: string;
  /** OAuth `client_id` of the calling agent. */
  agentId: string;
  /** Pairwise subject of the calling user. */
  sub: string;
  /** Connection scopes at decision time; empty when no connection exists. */
  scopes: string[];
}

/** Options for {@link oauthLaneProvider}. */
export interface LaneOAuthProviderOptions extends OAuthResourceOptions {
  /** Where completed step-ups are recorded. Required. */
  connections: LaneConnectionStore;
  /**
   * Confidential Lane client id used only for the token exchange.
   *
   * @defaultValue `MCP_USE_OAUTH_LANE_CLIENT_ID`
   */
  clientId?: string;
  /**
   * Confidential Lane client secret used only for the token exchange.
   *
   * @defaultValue `MCP_USE_OAUTH_LANE_CLIENT_SECRET`
   */
  clientSecret?: string;
  /**
   * Lane authorization server issuer.
   *
   * @defaultValue `MCP_USE_OAUTH_LANE_ISSUER`, then {@link LANE_DEFAULT_ISSUER}
   */
  issuer?: URL | string;
  /**
   * Connection scopes each application tool requires, keyed by tool name.
   * Tools absent from the map are callable by any connected caller.
   */
  scopes?: Record<string, string | readonly string[]>;
  /**
   * Gate behavior for callers without a connection.
   *
   * @defaultValue `"gate-all"`
   */
  enforcement?: LaneEnforcement;
  /** Observer for gate decisions. Exceptions are swallowed. */
  onGateEvent?: (event: LaneGateEvent) => void;
  /**
   * Register the `lane_session_info` diagnostic tool.
   *
   * @defaultValue `true`
   */
  sessionInfoTool?: boolean;
  /**
   * Register the `lane://auth-guide` resource.
   *
   * @defaultValue `true`
   */
  authGuide?: boolean;
  /** Replaces the default exchanger built from the client credentials. */
  exchanger?: LaneTokenExchanger;
  /**
   * Replaces the default Lane JWKS verifier. The default additionally
   * requires the `at+jwt` token type and a `jti` claim; a replacement is
   * used as-is.
   */
  createTokenVerifier?: (resource: URL) => OAuthTokenVerifier;
}
