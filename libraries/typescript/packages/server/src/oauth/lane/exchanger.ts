import { normalizedStrings, providerEndpoint } from "../jwt.js";
import {
  LANE_DEFAULT_ISSUER,
  type LaneTokenExchangeRequest,
  type LaneTokenExchangeResult,
  type LaneTokenExchanger,
} from "./types.js";

/** Options for {@link createLaneTokenExchanger}. */
export interface LaneTokenExchangerConfig {
  /** Confidential client id issued by Lane. */
  clientId: string;
  /** Confidential client secret issued by Lane. */
  clientSecret: string;
  /**
   * Issuer whose `/token` endpoint receives the exchange.
   *
   * @defaultValue {@link LANE_DEFAULT_ISSUER}
   */
  issuer?: string;
  /** Explicit token endpoint; overrides the issuer-derived one. */
  tokenEndpoint?: string;
  /**
   * Request timeout in milliseconds.
   *
   * @defaultValue `10000`
   */
  timeoutMs?: number;
  /** Fetch implementation, for tests. */
  fetchImpl?: typeof fetch;
}

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

/**
 * Creates the RFC 8693 exchanger the step-up tool uses. Authenticates with
 * `client_secret_basic`; Lane refuses the exchange grant for public clients.
 * No `scope` parameter is sent: Lane decides what the exchanged token carries.
 *
 * @throws A `TypeError` when either credential is missing.
 */
export function createLaneTokenExchanger(
  config: LaneTokenExchangerConfig
): LaneTokenExchanger {
  if (!config.clientId || !config.clientSecret) {
    throw new TypeError(
      "createLaneTokenExchanger requires clientId and clientSecret; the " +
        "exchange grant refuses a public client"
    );
  }
  const issuer = (config.issuer ?? LANE_DEFAULT_ISSUER).replace(/\/+$/, "");
  const endpoint = config.tokenEndpoint ?? providerEndpoint(issuer, "token");
  const timeoutMs = config.timeoutMs ?? 10_000;
  const fetchImpl = config.fetchImpl ?? fetch;
  const credentials = btoa(
    `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`
  );

  return {
    async exchange(
      request: LaneTokenExchangeRequest
    ): Promise<LaneTokenExchangeResult> {
      const body = new URLSearchParams({
        grant_type: TOKEN_EXCHANGE_GRANT,
        subject_token: request.subjectToken,
        subject_token_type: ACCESS_TOKEN_TYPE,
        resource: request.resource,
      });

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Basic ${credentials}`,
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "Error";
        throw new Error(`token exchange could not reach ${endpoint}: ${name}`);
      }

      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok) {
        const code =
          typeof payload["error"] === "string"
            ? payload["error"]
            : "unknown_error";
        const description =
          typeof payload["error_description"] === "string"
            ? `: ${payload["error_description"]}`
            : "";
        throw new Error(
          `token exchange refused: ${response.status} ${code}${description}`
        );
      }

      const accessToken = payload["access_token"];
      if (typeof accessToken !== "string" || accessToken.length === 0) {
        throw new Error("token exchange returned no access_token");
      }
      const expiresIn = payload["expires_in"];
      return {
        accessToken,
        scopes: normalizedStrings(payload["scope"]),
        ...(typeof expiresIn === "number" &&
          Number.isFinite(expiresIn) && { expiresIn }),
      };
    },
  };
}
