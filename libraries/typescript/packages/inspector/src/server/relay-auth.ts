import type { Context } from "hono";

/** Browser-facing capability header for the product relay. */
export const INSPECTOR_RELAY_CAPABILITY_HEADER = "X-Inspector-Relay-Token";

/** Non-secret target context supplied to the embedding application's verifier. */
export type InspectorRelayTarget = {
  /** URL origin of the requested upstream target. */
  origin: string;
  /** URL pathname of the requested upstream target; query and fragment are omitted. */
  pathname: string;
  /** Effective HTTP method that the relay will forward upstream. */
  method: string;
};

/**
 * Product authentication hook for relay capabilities.
 *
 * Existing one-argument `(c) => boolean` callbacks remain valid. Hosted
 * deployments should use the second argument to bind a short-lived
 * capability to the target origin/path and effective method.
 */
export type InspectorRelayAuthenticator = (
  c: Context,
  target: InspectorRelayTarget | undefined
) => Promise<boolean> | boolean;

/** Parse only the target identity needed by authentication, without network I/O. */
export function inspectorRelayTarget(
  value: unknown,
  method: string
): InspectorRelayTarget | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return {
      origin: url.origin,
      pathname: url.pathname || "/",
      method: method.toUpperCase(),
    };
  } catch {
    return undefined;
  }
}
