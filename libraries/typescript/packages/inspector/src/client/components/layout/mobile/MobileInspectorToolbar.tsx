import { JsonRpcLoggerView } from "@/client/components/logging/JsonRpcLoggerView";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { GithubIcon } from "@/client/components/ui/github-icon";
import { useInspector } from "@/client/context/InspectorContext";
import { useHostedSession } from "@/client/hooks/useHostedSession";
import { cn } from "@/client/lib/utils";
import { ManufactLogomark } from "@/client/components/chat/providerMeta";
import { MCPDeployClickEvent, captureInspectorEvent } from "@/client/telemetry";
import { ScrollText } from "lucide-react";
import { createPortal } from "react-dom";
import { useIsLgUp } from "../useTunnelPopoverOpen";

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 -28.5 256 256"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M216.856339,16.5966031 C200.285002,8.84328665 182.566144,3.2084988 164.041564,0 C161.766523,4.11318106 159.108624,9.64549908 157.276099,14.0464379 C137.583995,11.0849896 118.072967,11.0849896 98.7430163,14.0464379 C96.9108417,9.64549908 94.1925838,4.11318106 91.8971895,0 C73.3526068,3.2084988 55.6133949,8.86399117 39.0420583,16.6376612 C5.61752293,67.146514 -3.4433191,116.400813 1.08711069,164.955721 C23.2560196,181.510915 44.7403634,191.567697 65.8621325,198.148576 C71.0772151,190.971126 75.7283628,183.341335 79.7352139,175.300261 C72.104019,172.400575 64.7949724,168.822202 57.8887866,164.667963 C59.7209612,163.310589 61.5131304,161.891452 63.2445898,160.431257 C105.36741,180.133187 151.134928,180.133187 192.754523,160.431257 C194.506336,161.891452 196.298154,163.310589 198.110326,164.667963 C191.183787,168.842556 183.854737,172.420929 176.223542,175.320965 C180.230393,183.341335 184.861538,190.991831 190.096624,198.16893 C211.238746,191.588051 232.743023,181.531619 254.911949,164.955721 C260.227747,108.668201 245.831087,59.8662432 216.856339,16.5966031 Z M85.4738752,135.09489 C72.8290281,135.09489 62.4592217,123.290155 62.4592217,108.914901 C62.4592217,94.5396472 72.607595,82.7145587 85.4738752,82.7145587 C98.3405064,82.7145587 108.709962,94.5189427 108.488529,108.914901 C108.508531,123.290155 98.3405064,135.09489 85.4738752,135.09489 Z M170.525237,135.09489 C157.88039,135.09489 147.510584,123.290155 147.510584,108.914901 C147.510584,94.5396472 157.658606,82.7145587 170.525237,82.7145587 C183.391518,82.7145587 193.761324,94.5189427 193.539891,108.914901 C193.539891,123.290155 183.391518,135.09489 170.525237,135.09489 Z"
        fillRule="nonzero"
      />
    </svg>
  );
}

const toolbarItemClass =
  "flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:text-foreground active:text-foreground";

interface MobileInspectorToolbarProps {
  serverId?: string;
  rpcLoggerOpen: boolean;
  onRpcLoggerOpenChange: (open: boolean) => void;
}

export function MobileInspectorToolbar({
  serverId,
  rpcLoggerOpen,
  onRpcLoggerOpenChange,
}: MobileInspectorToolbarProps) {
  const isLgUp = useIsLgUp();
  const { embeddedConfig } = useInspector();
  const { user } = useHostedSession(embeddedConfig.chatApiUrl);

  const manufactHref = user
    ? "https://manufact.com/cloud?ref=mcp-use-inspector"
    : "https://manufact.com/signup?ref=mcp-use-inspector";

  const onManufactClick = () => {
    try {
      captureInspectorEvent(
        new MCPDeployClickEvent({
          referrer: "mcp-use-inspector-mobile-toolbar",
        })
      ).catch(() => {});
    } catch {
      // ignore telemetry errors
    }
  };

  return (
    <>
      {typeof document !== "undefined" &&
        createPortal(
          <nav
            aria-label="Inspector shortcuts"
            className="fixed inset-x-0 bottom-0 z-[100] flex items-center bg-transparent px-4 pt-(--mobile-chrome-gap) pb-[calc(var(--mobile-chrome-gap)+env(safe-area-inset-bottom))] lg:hidden"
          >
            <button
              type="button"
              onClick={() => onRpcLoggerOpenChange(!rpcLoggerOpen)}
              className={cn(
                toolbarItemClass,
                rpcLoggerOpen && "text-foreground"
              )}
              aria-label="RPC logs"
              aria-pressed={rpcLoggerOpen}
            >
              <ScrollText className="size-4 shrink-0" />
            </button>
            <a
              href="https://github.com/mcp-use/mcp-use"
              target="_blank"
              rel="noopener noreferrer"
              className={toolbarItemClass}
              aria-label="GitHub"
            >
              <GithubIcon className="size-4 shrink-0" />
            </a>
            <a
              href="https://discord.gg/XkNkSkMz3V"
              target="_blank"
              rel="noopener noreferrer"
              className={toolbarItemClass}
              aria-label="Discord"
            >
              <DiscordIcon className="size-4 shrink-0" />
            </a>
            <a
              href={manufactHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onManufactClick}
              className={toolbarItemClass}
              aria-label="manufact.com"
            >
              <ManufactLogomark size={16} />
            </a>
          </nav>,
          document.body
        )}

      {!isLgUp && (
        <Sheet open={rpcLoggerOpen} onOpenChange={onRpcLoggerOpenChange}>
          <SheetContent
            side="bottom"
            className="z-[101] flex h-[min(85dvh,720px)] flex-col gap-0 rounded-t-2xl border-zinc-200 p-0 dark:border-zinc-700"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>RPC logs</SheetTitle>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 pt-1">
              <JsonRpcLoggerView
                serverIds={serverId ? [serverId] : undefined}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
