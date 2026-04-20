/**
 * LoginModal — shown when the free-tier rate limit is hit OR when the user
 * clicks the "Sign in" CTA inside the hosted-mode ConfigurationDialog.
 *
 * Uses the app's standard Radix Dialog so it gets:
 *  • Backdrop click / Escape to close (via `onDismiss`).
 *  • Smooth fade + zoom animation consistent with other dialogs.
 *  • Built-in close (X) button in the corner.
 *
 * Escape hatches it offers:
 *  1. Sign in to Manufact (email/password or Google/GitHub OAuth).
 *     On success `manufact:session-changed` is dispatched so HostedUserMenu
 *     re-fetches the session, then `onDismiss` is called.
 *  2. Use your own API key (`onUseApiKey` prop, optional). Delegated to the
 *     parent (ChatTab → forceClientSide + open ConfigurationDialog).
 */
import { useCallback, useState } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";

import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";

/* ------------------------------------------------------------------ */
/* Inline OAuth brand icons (no extra dependency)                       */
/* ------------------------------------------------------------------ */

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Divider                                                              */
/* ------------------------------------------------------------------ */

function Divider({ text }: { text: string }) {
  return (
    <div className="relative flex items-center">
      <div className="flex-grow border-t border-border" />
      <span className="mx-3 flex-shrink text-xs text-muted-foreground">
        {text}
      </span>
      <div className="flex-grow border-t border-border" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                        */
/* ------------------------------------------------------------------ */

interface LoginModalProps {
  /** Base origin of the Manufact backend (e.g. `https://manufact.com`). */
  authOrigin: string;
  /** Called after a successful login or when the user dismisses the dialog. */
  onDismiss: () => void;
  /** Called when the user chooses to use their own API key instead of logging in. */
  onUseApiKey?: () => void;
}

export function LoginModal({
  authOrigin,
  onDismiss,
  onUseApiKey,
}: LoginModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"email" | "google" | "github" | null>(
    null
  );

  const handleSuccess = useCallback(() => {
    window.dispatchEvent(new CustomEvent("manufact:session-changed"));
    onDismiss();
  }, [onDismiss]);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading("email");
    try {
      const res = await fetch(`${authOrigin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, rememberMe: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string }).message ||
            "Incorrect email or password."
        );
      }
      handleSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setLoading(null);
    }
  };

  const handleOAuth = (provider: "google" | "github") => {
    setError(null);
    setLoading(provider);

    // Use a dedicated static page as the OAuth callback so the popup closes
    // itself (via `window.close()` + postMessage) the moment better-auth
    // finishes setting the session cookie — instead of loading the whole
    // inspector inside the popup while we wait for the parent's session poll.
    const callbackURL = `${window.location.origin}/inspector/oauth-popup-closed.html`;

    fetch(`${authOrigin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ provider, callbackURL }),
    })
      .then((res) => res.json())
      .then((data: { url?: string }) => {
        if (!data.url) throw new Error("No redirect URL returned");
        // NOTE: intentionally *without* `noopener` so the callback HTML can
        // postMessage back to us and so we retain a `popup` reference to
        // force-close it if the self-close in the callback page is blocked.
        const popup = window.open(
          data.url,
          "manufact-oauth",
          "width=500,height=650"
        );

        // Fast path: callback page posts `manufact:oauth-complete` when it
        // loads. Finish up immediately.
        const onMessage = (ev: MessageEvent) => {
          if (ev.data?.type !== "manufact:oauth-complete") return;
          window.removeEventListener("message", onMessage);
          clearInterval(poll);
          setLoading(null);
          try {
            popup?.close();
          } catch {
            /* ignore */
          }
          handleSuccess();
        };
        window.addEventListener("message", onMessage);

        // Fallback path: popup blocked postMessage → poll the session.
        const poll = setInterval(async () => {
          const closed = !popup || popup.closed;
          try {
            const sr = await fetch(`${authOrigin}/api/auth/get-session`, {
              credentials: "include",
            });
            const sd = await sr.json().catch(() => null);
            if (sd?.user) {
              clearInterval(poll);
              window.removeEventListener("message", onMessage);
              setLoading(null);
              if (!closed) {
                try {
                  popup?.close();
                } catch {
                  /* ignore */
                }
              }
              handleSuccess();
              return;
            }
          } catch {
            /* ignore fetch errors while polling */
          }
          if (closed) {
            clearInterval(poll);
            window.removeEventListener("message", onMessage);
            setLoading(null);
          }
        }, 2000);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "OAuth failed.");
        setLoading(null);
      });
  };

  const isLoading = loading !== null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in to Manufact</DialogTitle>
          <DialogDescription>
            Sign in to unlock generous usage limits on the Manufact free tier.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleEmailSignIn} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="lm-email">Email</Label>
            <Input
              id="lm-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              disabled={isLoading}
              required
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lm-password">Password</Label>
            <div className="relative">
              <Input
                id="lm-password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                disabled={isLoading}
                required
                autoComplete="current-password"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <Button type="submit" disabled={isLoading} className="w-full">
            {loading === "email" ? (
              <>
                <Spinner className="mr-2" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <Divider text="Or continue with" />

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            type="button"
            disabled={isLoading}
            onClick={() => handleOAuth("google")}
          >
            {loading === "google" ? (
              <Spinner className="mr-2" />
            ) : (
              <GoogleIcon className={cn("mr-2 h-4 w-4")} />
            )}
            Google
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={isLoading}
            onClick={() => handleOAuth("github")}
          >
            {loading === "github" ? (
              <Spinner className="mr-2" />
            ) : (
              <GitHubIcon className={cn("mr-2 h-4 w-4")} />
            )}
            GitHub
          </Button>
        </div>

        {onUseApiKey && (
          <>
            <Divider text="or" />
            <button
              type="button"
              disabled={isLoading}
              onClick={onUseApiKey}
              className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
            >
              Use your own API key
            </button>
          </>
        )}

        <p className="text-xs text-center text-muted-foreground pt-1">
          By signing in you agree to our{" "}
          <a
            href="https://manufact.com/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Terms
          </a>{" "}
          and{" "}
          <a
            href="https://manufact.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Privacy Policy
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}
