import { Button } from "@/client/components/ui/button";
import type { ManagedChatNotice } from "./managedChatNotice";

interface ChatManagedNoticeProps {
  notice: ManagedChatNotice;
  onConfigureApiKey: () => void;
  onSignIn?: () => void;
  authorizing?: boolean;
}

export function ChatManagedNotice({
  notice,
  onConfigureApiKey,
  onSignIn,
  authorizing = false,
}: ChatManagedNoticeProps) {
  return (
    <div className="mb-2 flex w-full justify-center px-2 sm:px-4">
      <p
        role="status"
        data-testid="chat-managed-notice"
        className="max-w-3xl rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-center text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100"
      >
        {notice.kind === "cloud_unavailable" && (
          <>
            Cloud chat is currently not available.{" "}
            <ConfigureLink onClick={onConfigureApiKey} />
          </>
        )}

        {notice.kind === "login_required" && (
          <>
            Sign in through Manufact Cloud to continue with managed chat.{" "}
            {onSignIn && (
              <>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0 align-baseline text-sm text-amber-900 hover:text-amber-700 dark:text-amber-100 dark:hover:text-amber-200"
                  disabled={authorizing}
                  onClick={onSignIn}
                >
                  {authorizing ? "Authorizing…" : "Sign in"}
                </Button>
                {" · "}
              </>
            )}
            <ConfigureLink onClick={onConfigureApiKey} />
          </>
        )}

        {notice.kind === "credits_exhausted" && (
          <>
            {notice.message ??
              "You've used your included free plan credits for managed chat."}{" "}
            {notice.billingUrl && (
              <>
                <a
                  href={notice.billingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-200"
                >
                  Upgrade your plan
                </a>
                {" · "}
              </>
            )}
            <ConfigureLink onClick={onConfigureApiKey} />
          </>
        )}
      </p>
    </div>
  );
}

function ConfigureLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-200"
      data-testid="chat-managed-notice-configure-link"
    >
      Configure your own API key
    </button>
  );
}
