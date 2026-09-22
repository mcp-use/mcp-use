import {
  NativeIdentityError,
  type NativeIdentity,
  type NativeIdentityAdapter,
} from "mcp-use/oauth/native-identity";
import {
  createFirebaseIdentity,
  FirebaseIdentityError,
  type FirebaseIdentity,
  type FirebaseWebConfig,
} from "./identity.js";

/** Checks Firebase account status and renews credentials under the native bridge's lease. */
export function firebaseIdentityAdapter(
  config: FirebaseWebConfig
): NativeIdentityAdapter {
  const firebase = createFirebaseIdentity(config);
  const normalize = (
    identity: FirebaseIdentity,
    refreshToken: string,
    idToken: string
  ): NativeIdentity => ({
    subject: identity.uid,
    profile: {
      name: identity.name,
      email: identity.email,
      emailVerified: identity.emailVerified,
    },
    binding: {
      uid: identity.uid,
      authTime: identity.authTime,
      refreshToken,
      idToken,
    },
  });
  return {
    source: JSON.stringify(["firebase", config.projectId, null]),
    async authenticate({ proof }) {
      if (
        !isRecord(proof) ||
        typeof proof.idToken !== "string" ||
        typeof proof.refreshToken !== "string"
      ) {
        throw new NativeIdentityError("invalid");
      }
      try {
        const verified = await firebase.verify({
          idToken: proof.idToken,
          refreshToken: proof.refreshToken,
        });
        return {
          identity: normalize(
            verified.identity,
            verified.refreshToken,
            verified.idToken
          ),
        };
      } catch (error) {
        throw nativeError(error);
      }
    },
    async revalidate(binding, signal) {
      if (
        !isRecord(binding) ||
        typeof binding.uid !== "string" ||
        typeof binding.authTime !== "number" ||
        typeof binding.refreshToken !== "string"
      ) {
        return { status: "invalid" };
      }
      try {
        if (signal.aborted) return { status: "unavailable" };
        // Each Firebase request is bounded. Once rotation starts, finish
        // verification so the bridge can save the replacement after cancellation.
        const verified = await firebase.refresh(binding.refreshToken, {
          uid: binding.uid,
          authTime: binding.authTime,
        });
        return {
          status: "valid",
          identity: normalize(
            verified.identity,
            verified.refreshToken,
            verified.idToken
          ),
        };
      } catch (error) {
        return {
          status: signal.aborted ? "unavailable" : nativeError(error).code,
        };
      }
    },
    async checkStatus(binding, signal) {
      if (
        !isRecord(binding) ||
        typeof binding.uid !== "string" ||
        typeof binding.authTime !== "number" ||
        typeof binding.idToken !== "string"
      )
        return "invalid";
      try {
        await firebase.checkStatus(
          binding.idToken,
          {
            uid: binding.uid,
            authTime: binding.authTime,
          },
          signal
        );
        return signal.aborted ? "unavailable" : "valid";
      } catch (error) {
        if (signal.aborted) return "unavailable";
        return error instanceof FirebaseIdentityError &&
          error.code === "token_expired"
          ? "expired"
          : nativeError(error).code;
      }
    },
  };
}

function nativeError(error: unknown): NativeIdentityError {
  return new NativeIdentityError(
    error instanceof FirebaseIdentityError &&
      (error.code === "invalid_session" || error.code === "token_expired")
      ? "invalid"
      : "unavailable"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
