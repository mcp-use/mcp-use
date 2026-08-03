import { cn } from "@/client/lib/utils";
import type { TabType } from "@/client/context/InspectorContext";
import {
  isInspectorSamplingAvailable,
  STATELESS_SAMPLING_UNSUPPORTED_MESSAGE,
} from "@/client/utils/samplingProtocol";
import type { McpServer } from "@mcp-use/client/react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { getTabCount, shouldShowDot } from "../layoutHeaderUtils";
import type { LayoutTabDef } from "../layoutTabs";
import { LAYOUT_TABS } from "../layoutTabs";
import { useSidebarProximityRowRefs } from "./SidebarProximityNav";
import {
  sidebarMenuButtonClass,
  sidebarNavLabelClass,
  sidebarNavRowTrailingPaddingClass,
  sidebarNavTrailingSlotClass,
} from "./sidebar-nav-styles";

function SidebarNavCountBadge({ count }: { count: number }) {
  const wide = String(count).length >= 3;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center justify-center border border-border bg-zinc-200 px-1 text-[10px] font-medium tabular-nums leading-none text-foreground dark:bg-zinc-700",
        wide ? "min-w-5 rounded-md" : "size-5 min-w-5 rounded-full"
      )}
    >
      {count}
    </span>
  );
}

interface InspectorSidebarNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  selectedServer: McpServer;
  visibleTabs?: TabType[];
  collapsed: boolean;
}

type NavTab = Extract<LayoutTabDef, { label: string }>;

function isNavTab(tab: LayoutTabDef): tab is NavTab {
  return tab.id !== "separator";
}

export function InspectorSidebarNav({
  activeTab,
  onTabChange,
  selectedServer,
  visibleTabs,
  collapsed,
}: InspectorSidebarNavProps) {
  const getRowRef = useSidebarProximityRowRefs();

  const filteredTabs: NavTab[] = visibleTabs
    ? LAYOUT_TABS.filter(
        (t): t is NavTab => isNavTab(t) && visibleTabs.includes(t.id)
      )
    : LAYOUT_TABS.filter(isNavTab);

  return (
    <ul
      className="flex w-full min-w-0 flex-col gap-1 px-(--sidebar-nav-inset-x) group"
      data-collapsed={collapsed}
      aria-label="Inspector tabs"
    >
      {filteredTabs.map((tab, index) => {
        const count = getTabCount(tab.id, selectedServer);
        const showDot = shouldShowDot(tab.id, count, collapsed);
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const isDisabled =
          tab.id === "sampling" &&
          !isInspectorSamplingAvailable(selectedServer);
        const hasTrailing = count > 0 || showDot;

        const row = (
          <button
            ref={getRowRef(tab.id)}
            type="button"
            aria-disabled={isDisabled || undefined}
            tabIndex={isDisabled ? -1 : undefined}
            data-testid={`tab-${tab.id}`}
            data-active={isActive ? true : undefined}
            title={
              isDisabled ? STATELESS_SAMPLING_UNSUPPORTED_MESSAGE : undefined
            }
            onClick={() => {
              if (!isDisabled) onTabChange(tab.id);
            }}
            className={cn(
              sidebarMenuButtonClass,
              collapsed
                ? "size-8! w-8! max-w-8! shrink-0 justify-center gap-0 p-0!"
                : "w-full max-w-full sidebar-nav-pill-bleed-x pl-(--sidebar-nav-icon-pl-bleed) pr-(--sidebar-nav-pr-bleed)",
              hasTrailing && !collapsed && sidebarNavRowTrailingPaddingClass,
              "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
              isDisabled && "pointer-events-none"
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className={sidebarNavLabelClass}>{tab.label}</span>
          </button>
        );

        return (
          <li
            key={tab.id}
            className={cn("group/menu-item relative", index === 0 && "mt-4")}
          >
            {collapsed || isDisabled ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger
                  render={
                    isDisabled ? (
                      <span
                        className="block cursor-not-allowed"
                        title={STATELESS_SAMPLING_UNSUPPORTED_MESSAGE}
                      >
                        {row}
                      </span>
                    ) : (
                      row
                    )
                  }
                  nativeButton={!isDisabled}
                />
                <TooltipContent side="right">
                  {isDisabled
                    ? STATELESS_SAMPLING_UNSUPPORTED_MESSAGE
                    : count > 0
                      ? `${tab.label} (${count})`
                      : tab.label}
                </TooltipContent>
              </Tooltip>
            ) : (
              row
            )}
            {hasTrailing && !collapsed ? (
              <div className={sidebarNavTrailingSlotClass}>
                {count > 0 ? (
                  <SidebarNavCountBadge count={count} />
                ) : showDot ? (
                  <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-yellow-500 animate-status-pulse-yellow" />
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
