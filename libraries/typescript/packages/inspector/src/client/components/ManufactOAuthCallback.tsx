import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { completeManufactAuthorization } from "@/client/auth/manufact-auth";

export function ManufactOAuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void completeManufactAuthorization()
      .then(() => window.close())
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex max-w-md flex-col items-center gap-4 p-6 text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-destructive">
              Authorization failed
            </h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </>
        ) : (
          <>
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Completing Manufact authorization…
            </p>
          </>
        )}
      </div>
    </div>
  );
}
