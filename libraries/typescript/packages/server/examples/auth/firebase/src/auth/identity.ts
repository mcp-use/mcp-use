import {
  createRemoteJWKSet,
  customFetch,
  errors,
  jwksCache,
  jwtVerify,
  type JWKSCacheInput,
} from "jose";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Public Firebase configuration used by the browser sign-in page. */
export interface FirebaseWebConfig {
  /** Firebase project whose users may sign in. */
  projectId: string;
  /** Firebase Web API key. */
  apiKey: string;
  /** Authorized Firebase authentication domain. */
  authDomain: string;
  /** Firebase web application identifier. */
  appId: string;
}

/** Verified Google sign-in identity within the configured Firebase project. */
export interface FirebaseIdentity {
  /** Stable Firebase user identifier. */
  uid: string;
  /** Verified email address. */
  email: string;
  /** Display name, falling back to the verified email address. */
  name: string;
  /** Whether Firebase verified the email address. */
  emailVerified: boolean;
  /** Original Firebase authentication time in Unix seconds. */
  authTime: number;
}

/** Firebase credentials obtained together from the browser sign-in. */
export interface FirebaseCredentials {
  /** Signed Firebase ID token. */
  idToken: string;
  /** Firebase refresh token for the same user and authentication. */
  refreshToken: string;
}

/** Separates rejected credentials from Firebase service failures. */
export class FirebaseIdentityError extends Error {
  /** Expired ID tokens can be renewed; only invalid sessions should be revoked. */
  readonly code: "invalid_session" | "token_expired" | "unavailable";

  /** Creates a sanitized error without embedding credentials or upstream output. */
  constructor(code: "invalid_session" | "token_expired" | "unavailable") {
    super(
      code === "invalid_session"
        ? "Firebase session is invalid; sign in again"
        : code === "token_expired"
          ? "Firebase ID token needs renewal"
          : "Firebase authentication is temporarily unavailable"
    );
    this.name = "FirebaseIdentityError";
    this.code = code;
  }
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TOKEN_LENGTH = 16 * 1024;
const INVALID_CREDENTIAL_ERRORS = new Set([
  "INVALID_ID_TOKEN",
  "INVALID_REFRESH_TOKEN",
  "INVALID_GRANT",
  "INVALID_USER_TOKEN",
  "TOKEN_EXPIRED",
  "USER_DISABLED",
  "USER_NOT_FOUND",
  "CREDENTIAL_TOO_OLD_LOGIN_AGAIN",
  "PROJECT_NUMBER_MISMATCH",
]);

/** Verifies sign-in, checks live account status, and renews only the original session. */
export function createFirebaseIdentity(config: FirebaseWebConfig) {
  const projectId = config.projectId;
  const apiKey = config.apiKey;
  const issuer = `https://securetoken.google.com/${projectId}`;
  if (
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
    typeof apiKey !== "string" ||
    !apiKey ||
    apiKey.length > 512
  ) {
    throw new TypeError("Firebase projectId and apiKey are required");
  }
  if (
    typeof config.authDomain !== "string" ||
    config.authDomain.length > 253 ||
    !config.authDomain
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  ) {
    throw new TypeError(
      "Firebase authDomain must be a hostname without a scheme or path"
    );
  }
  if (
    typeof config.appId !== "string" ||
    config.appId.length > 256 ||
    !/^1:\d+:web:[a-z0-9]+$/i.test(config.appId)
  ) {
    throw new TypeError(
      "Firebase appId must be the web application identifier"
    );
  }
  const keyCache: JWKSCacheInput = {};

  async function verifyToken(
    idToken: string,
    signal?: AbortSignal
  ): Promise<FirebaseIdentity> {
    assertToken(idToken);
    try {
      if (signal?.aborted) throw new FirebaseIdentityError("unavailable");
      // Share cached keys, but keep each outbound fetch tied to its own request.
      const keys = createRemoteJWKSet(
        new URL(
          "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
        ),
        {
          [jwksCache]: keyCache,
          [customFetch]: (url, init) =>
            boundedFetch(url, {
              ...init,
              signal: AbortSignal.any([
                ...(init?.signal ? [init.signal] : []),
                ...(signal ? [signal] : []),
              ]),
            }),
          timeoutDuration: 10_000,
        }
      );
      const { payload, protectedHeader } = await jwtVerify(idToken, keys, {
        algorithms: ["RS256"],
        issuer,
        audience: projectId,
        requiredClaims: ["sub", "exp", "iat", "auth_time"],
      });
      if (signal?.aborted) throw new FirebaseIdentityError("unavailable");
      const now = Date.now() / 1000;
      const firebase = payload["firebase"];
      const authTime = payload["auth_time"];
      if (
        !protectedHeader.kid ||
        payload.aud !== projectId ||
        !payload.sub ||
        payload.sub.length > 128 ||
        typeof payload.iat !== "number" ||
        !Number.isSafeInteger(payload.iat) ||
        payload.iat > now ||
        typeof authTime !== "number" ||
        !Number.isSafeInteger(authTime) ||
        authTime <= 0 ||
        authTime > payload.iat ||
        !isRecord(firebase) ||
        firebase["sign_in_provider"] !== "google.com" ||
        firebase["tenant"] !== undefined ||
        payload["email_verified"] !== true ||
        typeof payload["email"] !== "string" ||
        payload["email"].length === 0 ||
        payload["email"].length > 254
      ) {
        throw new FirebaseIdentityError("invalid_session");
      }
      return {
        uid: payload.sub,
        email: payload["email"],
        name:
          typeof payload["name"] === "string" && payload["name"].length > 0
            ? payload["name"]
            : payload["email"],
        emailVerified: true,
        authTime,
      };
    } catch (error) {
      if (signal?.aborted) throw new FirebaseIdentityError("unavailable");
      if (error instanceof FirebaseIdentityError) throw error;
      if (error instanceof errors.JWTExpired)
        throw new FirebaseIdentityError("token_expired");
      if (
        error instanceof errors.JWTClaimValidationFailed ||
        error instanceof errors.JWTInvalid ||
        error instanceof errors.JWSInvalid ||
        error instanceof errors.JWSSignatureVerificationFailed ||
        error instanceof errors.JOSEAlgNotAllowed ||
        error instanceof errors.JWKSNoMatchingKey
      ) {
        throw new FirebaseIdentityError("invalid_session");
      }
      throw new FirebaseIdentityError("unavailable");
    }
  }

  async function refresh(
    refreshToken: string,
    expected: Pick<FirebaseIdentity, "uid" | "authTime">,
    signal?: AbortSignal
  ) {
    assertToken(refreshToken);
    const refreshed = await firebaseRequest(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      signal
    );
    const idToken = refreshed["access_token"] ?? refreshed["id_token"];
    if (
      typeof idToken !== "string" ||
      typeof refreshed["refresh_token"] !== "string"
    ) {
      throw new FirebaseIdentityError("unavailable");
    }
    // Firebase's refresh endpoint rejects revoked credentials and disabled users.
    // Verify its replacement before returning it for persistence. A separate
    // account lookup must not lose a rotated token if that lookup is unavailable.
    const identity = await verifyToken(idToken, signal);
    if (
      identity.uid !== expected.uid ||
      identity.authTime !== expected.authTime
    ) {
      throw new FirebaseIdentityError("invalid_session");
    }
    assertToken(refreshed["refresh_token"]);
    return { identity, refreshToken: refreshed["refresh_token"], idToken };
  }

  async function checkStatus(
    idToken: string,
    expected: Pick<FirebaseIdentity, "uid" | "authTime">,
    signal?: AbortSignal
  ): Promise<FirebaseIdentity> {
    if (signal?.aborted) throw new FirebaseIdentityError("unavailable");
    const identity = await verifyToken(idToken, signal);
    if (
      identity.uid !== expected.uid ||
      identity.authTime !== expected.authTime
    ) {
      throw new FirebaseIdentityError("invalid_session");
    }
    const account = await firebaseRequest(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      { idToken },
      signal
    );
    const users = account["users"];
    if (!Array.isArray(users)) {
      throw new FirebaseIdentityError("unavailable");
    }
    if (users.length === 0) {
      throw new FirebaseIdentityError("invalid_session");
    }
    const user: unknown = users[0];
    if (
      users.length !== 1 ||
      !isRecord(user) ||
      typeof user["localId"] !== "string" ||
      (user["disabled"] !== undefined && typeof user["disabled"] !== "boolean")
    ) {
      throw new FirebaseIdentityError("unavailable");
    }
    if (user["localId"] !== identity.uid) {
      throw new FirebaseIdentityError("invalid_session");
    }
    if (
      user["validSince"] !== undefined &&
      (typeof user["validSince"] !== "string" ||
        !/^\d+$/.test(user["validSince"]))
    ) {
      throw new FirebaseIdentityError("unavailable");
    }
    const validSince =
      user["validSince"] === undefined ? 0 : Number(user["validSince"]);
    if (!Number.isSafeInteger(validSince) || validSince < 0) {
      throw new FirebaseIdentityError("unavailable");
    }
    if (
      user["disabled"] === true ||
      (user["tenantId"] !== undefined && user["tenantId"] !== "") ||
      user["emailVerified"] !== true ||
      user["email"] !== identity.email ||
      identity.authTime < validSince
    ) {
      throw new FirebaseIdentityError("invalid_session");
    }
    return identity;
  }

  return {
    issuer,
    async verify(credentials: FirebaseCredentials) {
      const identity = await verifyToken(credentials.idToken);
      if (Date.now() / 1000 - identity.authTime > 300) {
        throw new FirebaseIdentityError("invalid_session");
      }
      await checkStatus(credentials.idToken, identity);
      return refresh(credentials.refreshToken, identity);
    },
    refresh,
    checkStatus,
  } as const;
}

function assertToken(token: string): void {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH
  ) {
    throw new FirebaseIdentityError("invalid_session");
  }
}

async function firebaseRequest(
  url: string,
  body: URLSearchParams | Record<string, string>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const response = await boundedFetch(url, {
    method: "POST",
    headers: {
      "content-type":
        body instanceof URLSearchParams
          ? "application/x-www-form-urlencoded"
          : "application/json",
    },
    body:
      body instanceof URLSearchParams ? body.toString() : JSON.stringify(body),
    ...(signal !== undefined && { signal }),
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new FirebaseIdentityError("unavailable");
  }
  if (!isRecord(result)) throw new FirebaseIdentityError("unavailable");
  if (!response.ok) {
    const error = result["error"];
    const code =
      isRecord(error) && typeof error["message"] === "string"
        ? error["message"].split(/[ :]/, 1)[0]
        : undefined;
    throw new FirebaseIdentityError(
      response.status < 500 && code && INVALID_CREDENTIAL_ERRORS.has(code)
        ? "invalid_session"
        : "unavailable"
    );
  }
  return result;
}

async function boundedFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const timeout = AbortSignal.timeout(10_000);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new FirebaseIdentityError("unavailable");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new FirebaseIdentityError("unavailable");
    const bytes = new Uint8Array(MAX_RESPONSE_BYTES);
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.byteLength > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new FirebaseIdentityError("unavailable");
        }
        bytes.set(value, size);
        size += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    return new Response(bytes.subarray(0, size), {
      status: response.status,
      headers: response.headers,
    });
  } catch {
    throw new FirebaseIdentityError("unavailable");
  }
}
