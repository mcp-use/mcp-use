/** Firebase identity verification for the shared OAuth login bridge. */

import { isRecord } from "./guards.js";

/** JSON data retained privately by the login bridge, never sent to MCP clients. */
export type NativeIdentityBinding =
  | null
  | boolean
  | number
  | string
  | NativeIdentityBinding[]
  | { [key: string]: NativeIdentityBinding };

/** Optional profile attributes obtained from a trusted identity source. */
export interface NativeIdentityProfile {
  /** Email address; not an account-linking key. */
  email?: string;
  /** Whether the identity source has verified the email address. */
  emailVerified?: boolean;
  /** Display name. */
  name?: string;
  /** Profile image URL. */
  image?: string;
}

/** Verified identity within an adapter's fixed source namespace. */
export interface NativeIdentity {
  /** Stable subject identifier; never substitute an email address. */
  subject: string;
  /** Optional user-facing attributes. */
  profile?: NativeIdentityProfile;
  /** Private JSON reference used to revalidate the original native session. */
  binding?: NativeIdentityBinding;
}

/** Browser request and already-parsed evidence supplied by the shared bridge. */
export interface NativeAuthenticationContext {
  /** Original request, including cookies needed by a trusted session reader. */
  request: Request;
  /** Untrusted native evidence; adapters must not read the request body again. */
  proof: unknown;
}

/** Identity and optional native-session cookie updates from authentication. */
export interface NativeAuthenticationResult {
  /** Verified identity, including any private lifecycle reference. */
  identity: NativeIdentity;
  /** Session cookie updates; the bridge must forward only Set-Cookie values. */
  responseHeaders?: Headers;
}

/** Outcome of checking an existing native-session reference. */
export type NativeIdentityRevalidation =
  | {
      /** The native identity remains usable. */
      status: "valid";
      /** Same subject, with current profile and any replacement binding. */
      identity: NativeIdentity;
    }
  | {
      /** The native session has expired, been revoked, or become invalid. */
      status: "invalid";
    }
  | {
      /** A transient service failure prevented an authoritative check. */
      status: "unavailable";
    };

/** Small native identity boundary; OAuth grants and tokens remain engine-owned. */
export interface NativeIdentityAdapter {
  /** Fixed provider-instance namespace, independent of browser input. */
  readonly source: string;
  /** Verify native evidence and identify the user without issuing OAuth tokens. */
  authenticate(
    context: NativeAuthenticationContext
  ): Promise<NativeAuthenticationResult>;
  /**
   * Check a privately stored session reference when the app requires linkage.
   * The bridge must reject a changed subject and persist replacement bindings.
   */
  revalidate?(
    binding: NativeIdentityBinding
  ): Promise<NativeIdentityRevalidation>;
  /**
   * Read current native account/session status for strict request verification.
   * Must not rotate credentials, replace the binding, or cache a valid result.
   * Return `invalid` only for an authoritative rejection and `unavailable` for
   * outages or an inconclusive response. Honor the abort signal when supported.
   */
  checkStatus?(
    binding: NativeIdentityBinding,
    signal: AbortSignal
  ): Promise<"valid" | "invalid" | "unavailable">;
}

/** Sanitized native authentication failure without upstream credentials. */
export class NativeIdentityError extends Error {
  /** Distinguishes unusable credentials from a temporary service failure. */
  readonly code: "invalid" | "unavailable";

  /** Creates a safe error for a rejected credential or unavailable source. */
  constructor(code: "invalid" | "unavailable") {
    super(
      code === "invalid"
        ? "Native identity is invalid; sign in again"
        : "Native identity verification is temporarily unavailable"
    );
    this.name = "NativeIdentityError";
    this.code = code;
  }
}

/** Relevant claims returned by Firebase Admin's verifyIdToken method. */
export interface FirebaseNativeToken {
  /** Firebase project audience. */
  aud: string;
  /** Firebase secure-token issuer. */
  iss: string;
  /** Firebase UID carried as the token subject. */
  sub: string;
  /** Firebase Admin's UID alias. */
  uid: string;
  /** Original authentication time in Unix seconds. */
  auth_time: number;
  /** Firebase sign-in and tenant claims. */
  firebase: {
    /** Provider used for this native login. */
    sign_in_provider: string;
    /** Tenant, when using multi-tenant Firebase Authentication. */
    tenant?: string;
  };
}

/** Relevant fields returned by Firebase Admin's getUser method. */
export interface FirebaseNativeUser {
  /** Stable Firebase UID. */
  uid: string;
  /** Whether the account is disabled. */
  disabled: boolean;
  /** Earliest valid authentication time as a UTC date string, when set. */
  tokensValidAfterTime?: string;
  /** Current email address, when present. */
  email?: string;
  /** Whether the current email address is verified. */
  emailVerified: boolean;
  /** Current display name. */
  displayName?: string;
  /** Current profile image URL. */
  photoURL?: string;
}

/** Injects an initialized Firebase Admin Auth or tenant-aware Auth instance. */
export interface FirebaseAdminIdentityOptions {
  /** Firebase project accepted by this adapter. */
  projectId: string;
  /** Expected tenant; omit to reject tenant-scoped tokens. */
  tenantId?: string;
  /** Official Admin methods from the same configured project and tenant. */
  auth: {
    /** Verify the ID token; this adapter always enables revocation checking. */
    verifyIdToken(
      token: string,
      checkRevoked: boolean
    ): Promise<FirebaseNativeToken>;
    /** Read current account status for original-session revalidation. */
    getUser(uid: string): Promise<FirebaseNativeUser>;
  };
  /** Require this sign-in provider, for example `google.com`, when configured. */
  signInProvider?: string;
  /** Reject accounts without a verified email when the application requires it. */
  requireVerifiedEmail?: boolean;
  /** Maximum initial login age in seconds. Defaults to 300. */
  maxAuthenticationAge?: number;
}

/**
 * Creates an Admin-backed Firebase adapter accepting proof `{ idToken }`.
 * Revalidation retains the original UID and authentication time, checks current
 * disablement/revocation, and never stores a Firebase refresh token. Strict
 * request checks read the same authoritative account status without renewing
 * credentials. Callers supply Admin credentials and choose the session policy.
 */
export function createFirebaseAdminIdentityAdapter(
  options: FirebaseAdminIdentityOptions
): NativeIdentityAdapter {
  const projectId = configuredString(options.projectId, "Firebase projectId");
  const tenantId = optionalConfiguredString(
    options.tenantId,
    "Firebase tenantId"
  );
  const signInProvider = optionalConfiguredString(
    options.signInProvider,
    "Firebase signInProvider"
  );
  const maxAge = options.maxAuthenticationAge ?? 300;
  if (!Number.isFinite(maxAge) || maxAge <= 0) {
    throw new TypeError("Firebase maxAuthenticationAge must be positive");
  }
  const source = JSON.stringify(["firebase", projectId, tenantId ?? null]);
  const issuer = `https://securetoken.google.com/${projectId}`;

  async function currentIdentity(
    uid: string,
    authTime: number
  ): Promise<NativeIdentity> {
    const user = await options.auth.getUser(uid);
    if (
      !isRecord(user) ||
      typeof user.uid !== "string" ||
      typeof user.disabled !== "boolean" ||
      typeof user.emailVerified !== "boolean" ||
      (user.tokensValidAfterTime !== undefined &&
        typeof user.tokensValidAfterTime !== "string")
    ) {
      throw new NativeIdentityError("unavailable");
    }
    const validAfter =
      user.tokensValidAfterTime === undefined
        ? 0
        : Date.parse(user.tokensValidAfterTime) / 1000;
    if (!Number.isFinite(validAfter)) {
      throw new NativeIdentityError("unavailable");
    }
    if (
      user.uid !== uid ||
      user.disabled ||
      authTime < validAfter ||
      (options.requireVerifiedEmail && (!user.email || !user.emailVerified))
    ) {
      throw new NativeIdentityError("invalid");
    }
    return {
      subject: uid,
      profile: {
        ...(user.email !== undefined && { email: user.email }),
        emailVerified: user.emailVerified,
        ...(user.displayName !== undefined && { name: user.displayName }),
        ...(user.photoURL !== undefined && { image: user.photoURL }),
      },
      binding: { uid, authTime },
    };
  }

  async function identityFromBinding(
    binding: NativeIdentityBinding
  ): Promise<NativeIdentity> {
    if (
      !isRecord(binding) ||
      !validSubject(binding["uid"]) ||
      !validAuthenticationTime(binding["authTime"])
    ) {
      throw new NativeIdentityError("invalid");
    }
    return currentIdentity(binding["uid"], binding["authTime"]);
  }

  return {
    source,
    async authenticate({ proof }) {
      try {
        const decoded = await options.auth.verifyIdToken(
          proofToken(proof, "idToken"),
          true
        );
        const now = Date.now() / 1000;
        if (
          decoded.aud !== projectId ||
          decoded.iss !== issuer ||
          !validSubject(decoded.uid) ||
          decoded.uid !== decoded.sub ||
          decoded.firebase?.tenant !== tenantId ||
          (signInProvider !== undefined &&
            decoded.firebase?.sign_in_provider !== signInProvider) ||
          !validAuthenticationTime(decoded.auth_time) ||
          now - decoded.auth_time > maxAge
        ) {
          throw new NativeIdentityError("invalid");
        }
        return {
          identity: await currentIdentity(decoded.uid, decoded.auth_time),
        };
      } catch (error) {
        throw firebaseError(error);
      }
    },
    async revalidate(binding) {
      try {
        return {
          status: "valid",
          identity: await identityFromBinding(binding),
        };
      } catch (error) {
        return { status: firebaseError(error).code };
      }
    },
    async checkStatus(binding, signal) {
      try {
        if (signal.aborted) return "unavailable";
        await identityFromBinding(binding);
        return signal.aborted ? "unavailable" : "valid";
      } catch (error) {
        return signal.aborted ? "unavailable" : firebaseError(error).code;
      }
    },
  };
}

function validSubject(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024;
}

function configuredString(value: string, name: string): string {
  if (!validSubject(value)) throw new TypeError(`${name} is required`);
  return value;
}

function optionalConfiguredString(
  value: string | undefined,
  name: string
): string | undefined {
  return value === undefined ? undefined : configuredString(value, name);
}

function validAuthenticationTime(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= Date.now() / 1000
  );
}

function checkedToken(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 16 * 1024) {
    throw new NativeIdentityError("invalid");
  }
  return value;
}

function proofToken(proof: unknown, key: string): string {
  if (!isRecord(proof)) throw new NativeIdentityError("invalid");
  return checkedToken(proof[key]);
}

function firebaseError(error: unknown): NativeIdentityError {
  if (error instanceof NativeIdentityError) return error;
  const invalidCodes = new Set([
    "auth/argument-error",
    "auth/invalid-argument",
    "auth/invalid-id-token",
    "auth/id-token-expired",
    "auth/id-token-revoked",
    "auth/user-disabled",
    "auth/user-not-found",
    "auth/tenant-id-mismatch",
  ]);
  return new NativeIdentityError(
    isRecord(error) && invalidCodes.has(String(error["code"]))
      ? "invalid"
      : "unavailable"
  );
}
