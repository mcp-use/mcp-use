import { Badge } from "@/client/components/ui/badge";
import {
  inspectorTabHeaderPadding,
  inspectorTabTitleClass,
} from "@/client/lib/font-weight";

export function ChatHistoryHeader({ count }: { count: number }) {
  return (
    <div
      className={`flex flex-row absolute top-0 right-0 z-10 w-full items-center justify-between gap-2 ${inspectorTabHeaderPadding}`}
    >
      <div className="flex items-center gap-2 rounded-full">
        <h2 className={inspectorTabTitleClass}>Chat History</h2>
        <Badge
          className="bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border-transparent"
          variant="outline"
        >
          {count}
        </Badge>
      </div>
    </div>
  );
}
