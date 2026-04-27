/**
 * HostedUserMenu — session-aware avatar for inspector.manufact.com
 *
 * Fetches the current user from `<chatApiUrl origin>/api/auth/get-session`
 * using the shared session cookie (works across *.manufact.com when the
 * backend runs with COOKIE_DOMAIN=.manufact.com).
 *
 * ── Integration points ───────────────────────────────────────────────────
 *  • Mounted by `LayoutHeader` when `embeddedConfig.chatApiUrl` is set.
 *  • `onUserResolved` callback lets LayoutHeader know whether the user is
 *    logged in so it can update the Deploy button href accordingly.
 *  • `fallback` prop: rendered at narrow widths when unauthenticated (logo).
 *  • Listens to the custom `manufact:session-changed` window event so that
 *    after a successful login in `LoginModal` the avatar appears immediately
 *    (LoginModal dispatches this event via `handleSuccess`).
 *
 * ── No extra infrastructure ──────────────────────────────────────────────
 *  Session check is a simple GET — no WebSockets or polling. The only
 *  re-check triggers are: initial mount and `manufact:session-changed`.
 */
import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { LayoutDashboard } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/client/components/ui/avatar";

interface HostedUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

function getInitial(
  name: string | null | undefined,
  email: string | null | undefined
): string {
  if (name?.[0]) return name[0].toUpperCase();
  if (email?.[0]) return email[0].toUpperCase();
  return "U";
}

interface HostedUserMenuProps {
  /** Origin of the chat API, used to derive /api/auth/get-session URL. */
  chatApiUrl: string;
  /** URL to navigate to when "Go to dashboard" is clicked. Defaults to https://manufact.com/cloud */
  dashboardUrl?: string;
  /** Rendered when the session has been checked and the user is not authenticated. */
  fallback?: React.ReactNode;
  /** Called once the session check resolves with the authenticated user or null. */
  onUserResolved?: (user: HostedUser | null) => void;
}

/**
 * Fetches the current user session from the Manufact backend using the shared
 * session cookie (`credentials: "include"`). When authenticated, renders a
 * user avatar that opens a dropdown menu with a "Go to dashboard" link.
 * Falls back to `null` (renders nothing) while loading or when unauthenticated.
 */
export function HostedUserMenu({
  chatApiUrl,
  dashboardUrl = "https://manufact.com/cloud",
  fallback = null,
  onUserResolved,
}: HostedUserMenuProps) {
  const [user, setUser] = useState<HostedUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchSession = useCallback(() => {
    let cancelled = false;
    const sessionUrl = `${new URL(chatApiUrl).origin}/api/auth/get-session`;

    fetch(sessionUrl, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) {
          const resolved = data?.user ?? null;
          setUser(resolved);
          setLoaded(true);
          onUserResolved?.(resolved);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true);
          onUserResolved?.(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chatApiUrl]);

  useEffect(() => {
    const cleanup = fetchSession();
    return cleanup;
  }, [fetchSession]);

  useEffect(() => {
    const handler = () => {
      fetchSession();
    };
    window.addEventListener("manufact:session-changed", handler);
    return () =>
      window.removeEventListener("manufact:session-changed", handler);
  }, [fetchSession]);

  // While the session check is still in-flight render nothing to avoid a flash.
  if (!loaded) return null;

  if (!user) return <>{fallback}</>;

  const initial = getInitial(user.name, user.email);
  const displayName = user.name ?? user.email ?? "User";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative h-8 w-8 shrink-0 rounded-full p-0 mr-2"
          aria-label="User menu"
        >
          <Avatar className="h-8 w-8 border border-zinc-300 dark:border-zinc-600">
            <AvatarImage src={user.image ?? ""} alt={displayName} />
            <AvatarFallback className="text-sm">{initial}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none truncate">
              {displayName}
            </p>
            {user.email && user.email !== displayName && (
              <p className="text-xs leading-none text-muted-foreground truncate">
                {user.email}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Go to dashboard
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
