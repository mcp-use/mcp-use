import { onMcpAuthorization } from "mcp-use/auth";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * OAuth Callback Page
 * 
 * Handles the OAuth redirect after user authorizes the app.
 * Exchanges the authorization code for tokens and redirects back to the app.
 */
export function OAuthCallback() {
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    console.log("[OAuthCallback] Component mounted, handling authorization...");
    console.log("[OAuthCallback] Current URL:", window.location.href);
    
    // Run the OAuth callback handler
    onMcpAuthorization()
      .then(() => {
        console.log("[OAuthCallback] Authorization successful");
        setStatus("success");
      })
      .catch((err) => {
        console.error("[OAuthCallback] Authorization failed:", err);
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (status === "processing") {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-white dark:bg-zinc-900">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-600 dark:text-zinc-400" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Completing authentication...
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-white dark:bg-zinc-900">
        <div className="max-w-md p-6">
          <h1 className="text-xl font-semibold text-red-600 dark:text-red-400 mb-2">
            Authentication Error
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
            {errorMessage}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            You can close this window and try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex items-center justify-center bg-white dark:bg-zinc-900">
      <div className="max-w-md p-6">
        <h1 className="text-xl font-semibold text-green-600 dark:text-green-400 mb-2">
          Authentication Successful!
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Redirecting you back...
        </p>
      </div>
    </div>
  );
}

