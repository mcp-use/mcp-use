import { JsonRpcLoggerView } from "@/client/components/logging/JsonRpcLoggerView";
import { cn } from "@/client/lib/utils";

export function SidebarRpcPanel({
  serverId,
  open,
}: {
  serverId: string;
  open: boolean;
}) {
  return (
    <aside
      aria-label="RPC Panel"
      aria-hidden={!open}
      className={cn(
        "relative hidden min-h-0 shrink-0 flex-col overflow-hidden transition-[width,margin] duration-200 ease-out lg:flex",
        open ? "w-80 lg:mr-[18px]" : "w-0 lg:mr-0"
      )}
    >
      <div
        className={cn(
          "flex h-full min-h-0 w-80 flex-col transition-opacity duration-200 ease-out",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <JsonRpcLoggerView serverIds={[serverId]} />
      </div>
    </aside>
  );
}
