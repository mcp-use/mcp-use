/**
 * useHostedSession — shared session probe for the hosted inspector
 *
 * Fetches the current user from `<chatApiUrl origin>/api/auth/get-session`
 * using the shared session cookie (works across *.manufact.com when the backend
 * runs with COOKIE_DOMAIN=.manufact.com).
 *
 * Single source of truth for "is the visitor signed in to Manufact?", consumed
 * by both `HostedUserMenu` (avatar) and `ChatTab` (so the free-tier sign-in
 * prompt is hidden once the user is authenticated — see MCP-2142).
 *
 * Re-checks on mount and whenever `manufact:session-changed` is dispatched
 * (LoginModal fires this after a successful sign-in), so the UI updates the
 * moment the session cookie is set without a page reload.
 */
import { useCallback, useEffect, useState } from "react";

export interface HostedUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface HostedSession {
  /** Authenticated user, or null when signed out / still loading. */
  user: HostedUser | null;
  /** True once the first session check has resolved (success or failure). */
  loaded: boolean;
}

/**
 * @param chatApiUrl - Hosted chat endpoint. When undefined/null the hook stays
 *   idle (no fetch) — local/BYOK inspector has no Manufact session to probe.
 */
export function useHostedSession(
  chatApiUrl: string | null | undefined
): HostedSession {
  const [user, setUser] = useState<HostedUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchSession = useCallback(() => {
    if (!chatApiUrl) {
      setUser(null);
      setLoaded(true);
      return () => {};
    }

    let cancelled = false;
    let sessionUrl: string;
    try {
      sessionUrl = `${new URL(chatApiUrl).origin}/api/auth/get-session`;
    } catch {
      setUser(null);
      setLoaded(true);
      return () => {};
    }

    fetch(sessionUrl, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setUser((data?.user as HostedUser | undefined) ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [chatApiUrl]);

  useEffect(() => fetchSession(), [fetchSession]);

  useEffect(() => {
    const handler = () => fetchSession();
    window.addEventListener("manufact:session-changed", handler);
    return () =>
      window.removeEventListener("manufact:session-changed", handler);
  }, [fetchSession]);

  return { user, loaded };
}
